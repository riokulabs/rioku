// Package gateway — access policy CRUD endpoints (#80).
//
// REST surface:
//
//	GET    /api/v1/auth/access-policies        — list, ordered by (priority ASC, created_at ASC)
//	POST   /api/v1/auth/access-policies        — create
//	GET    /api/v1/auth/access-policies/{id}   — read one
//	PUT    /api/v1/auth/access-policies/{id}   — full or partial update
//	DELETE /api/v1/auth/access-policies/{id}   — delete
//
// Read endpoints require `access-policies:read`; mutating endpoints require
// `access-policies:write`. Both permissions are seeded in migration 8.
//
// Stage-1 scope: the daemon persists policies and serves them; condition
// *evaluation* in the auth middleware is a stage-2 follow-up. The frontend
// can already drive full CRUD against this surface.
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// RegisterAccessPolicyRoutes registers the access policy CRUD endpoints.
func RegisterAccessPolicyRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("GET /api/v1/auth/access-policies",
		RequirePermission("access-policies:read")(http.HandlerFunc(handleListAccessPolicies(st))))
	mux.Handle("POST /api/v1/auth/access-policies",
		RequirePermission("access-policies:write")(http.HandlerFunc(handleCreateAccessPolicy(st))))
	mux.Handle("GET /api/v1/auth/access-policies/{id}",
		RequirePermission("access-policies:read")(http.HandlerFunc(handleGetAccessPolicy(st))))
	mux.Handle("PUT /api/v1/auth/access-policies/{id}",
		RequirePermission("access-policies:write")(http.HandlerFunc(handleUpdateAccessPolicy(st))))
	mux.Handle("DELETE /api/v1/auth/access-policies/{id}",
		RequirePermission("access-policies:write")(http.HandlerFunc(handleDeleteAccessPolicy(st))))
}

// ─── Wire types ─────────────────────────────────────────────────────────────

// accessPolicyDTO is the JSON wire shape returned to the admin panel. The
// fields mirror the store.AccessPolicy struct but with camelCase keys.
type accessPolicyDTO struct {
	ID          string                     `json:"id"`
	Name        string                     `json:"name"`
	Description string                     `json:"description"`
	Effect      string                     `json:"effect"`
	TargetType  string                     `json:"targetType"`
	TargetIDs   []string                   `json:"targetIds"`
	Conditions  []accessPolicyConditionDTO `json:"conditions"`
	Priority    int                        `json:"priority"`
	Enabled     bool                       `json:"enabled"`
	CreatedAt   string                     `json:"createdAt"`
	UpdatedAt   string                     `json:"updatedAt"`
}

type accessPolicyConditionDTO struct {
	Type   string         `json:"type"`
	Config map[string]any `json:"config"`
}

func toDTO(p *store.AccessPolicy) accessPolicyDTO {
	conditions := make([]accessPolicyConditionDTO, len(p.Conditions))
	for i, c := range p.Conditions {
		conditions[i] = accessPolicyConditionDTO{Type: c.Type, Config: c.Config}
	}
	targetIDs := p.TargetIDs
	if targetIDs == nil {
		targetIDs = []string{}
	}
	return accessPolicyDTO{
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		Effect:      string(p.Effect),
		TargetType:  string(p.TargetType),
		TargetIDs:   targetIDs,
		Conditions:  conditions,
		Priority:    p.Priority,
		Enabled:     p.Enabled,
		CreatedAt:   p.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:   p.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

// createPolicyRequest is the POST body. All fields except `name`, `effect`
// and `targetType` are optional; sensible defaults apply.
type createPolicyRequest struct {
	Name        string                     `json:"name"`
	Description string                     `json:"description"`
	Effect      string                     `json:"effect"`
	TargetType  string                     `json:"targetType"`
	TargetIDs   []string                   `json:"targetIds"`
	Conditions  []accessPolicyConditionDTO `json:"conditions"`
	Priority    *int                       `json:"priority"`
	Enabled     *bool                      `json:"enabled"`
}

// updatePolicyRequest is the PUT body. Pointer fields make every property
// optional — omitting a field leaves it untouched.
type updatePolicyRequest struct {
	Name        *string                     `json:"name,omitempty"`
	Description *string                     `json:"description,omitempty"`
	Effect      *string                     `json:"effect,omitempty"`
	TargetType  *string                     `json:"targetType,omitempty"`
	TargetIDs   *[]string                   `json:"targetIds,omitempty"`
	Conditions  *[]accessPolicyConditionDTO `json:"conditions,omitempty"`
	Priority    *int                        `json:"priority,omitempty"`
	Enabled     *bool                       `json:"enabled,omitempty"`
}

// ─── Validation helpers ─────────────────────────────────────────────────────

func validateEffect(e string) error {
	if e != string(store.AccessPolicyAllow) && e != string(store.AccessPolicyDeny) {
		return errors.New("effect must be 'allow' or 'deny'")
	}
	return nil
}

func validateTargetType(t string) error {
	switch store.AccessPolicyTargetType(t) {
	case store.AccessPolicyTargetRoles, store.AccessPolicyTargetUsers, store.AccessPolicyTargetAll:
		return nil
	}
	return errors.New("targetType must be one of: roles, users, all")
}

func conditionsFromDTO(in []accessPolicyConditionDTO) []store.AccessPolicyCondition {
	out := make([]store.AccessPolicyCondition, len(in))
	for i, c := range in {
		cfg := c.Config
		if cfg == nil {
			cfg = map[string]any{}
		}
		out[i] = store.AccessPolicyCondition{Type: c.Type, Config: cfg}
	}
	return out
}

// ─── Handlers ───────────────────────────────────────────────────────────────

func handleListAccessPolicies(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		policies, err := withReadTx(ctx, st, func(tx store.Tx) ([]*store.AccessPolicy, error) {
			return tx.ListAccessPolicies(ctx)
		})
		if err != nil {
			writeInternalError(w, r, "list access policies")
			return
		}
		dtos := make([]accessPolicyDTO, len(policies))
		for i, p := range policies {
			dtos[i] = toDTO(p)
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": dtos, "total": len(dtos)})
	}
}

func handleCreateAccessPolicy(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body createPolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if body.Name == "" {
			writeBadRequest(w, r, "name is required")
			return
		}
		if err := validateEffect(body.Effect); err != nil {
			writeBadRequest(w, r, err.Error())
			return
		}
		if err := validateTargetType(body.TargetType); err != nil {
			writeBadRequest(w, r, err.Error())
			return
		}
		priority := 100
		if body.Priority != nil {
			priority = *body.Priority
		}
		enabled := true
		if body.Enabled != nil {
			enabled = *body.Enabled
		}
		targetIDs := body.TargetIDs
		if targetIDs == nil {
			targetIDs = []string{}
		}

		ctx := r.Context()
		policy := &store.AccessPolicy{
			ID:          uuid.New().String(),
			Name:        body.Name,
			Description: body.Description,
			Effect:      store.AccessPolicyEffect(body.Effect),
			TargetType:  store.AccessPolicyTargetType(body.TargetType),
			TargetIDs:   targetIDs,
			Conditions:  conditionsFromDTO(body.Conditions),
			Priority:    priority,
			Enabled:     enabled,
		}

		var created *store.AccessPolicy
		if err := withWriteTx(ctx, st, func(tx store.Tx) error {
			out, err := tx.CreateAccessPolicy(ctx, policy)
			if err != nil {
				return err
			}
			created = out
			return nil
		}); err != nil {
			if errors.Is(err, store.ErrAccessPolicyDuplicate) {
				writeProblem(w, http.StatusConflict, errTypeValidation, "Conflict",
					"An access policy with that name already exists.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create access policy")
			return
		}
		writeJSON(w, http.StatusCreated, toDTO(created))
	}
}

func handleGetAccessPolicy(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		ctx := r.Context()
		policy, err := withReadTx(ctx, st, func(tx store.Tx) (*store.AccessPolicy, error) {
			return tx.GetAccessPolicy(ctx, id)
		})
		if err != nil {
			if errors.Is(err, store.ErrAccessPolicyNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeValidation, "Not found",
					"Access policy not found.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get access policy")
			return
		}
		writeJSON(w, http.StatusOK, toDTO(policy))
	}
}

func handleUpdateAccessPolicy(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body updatePolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if body.Effect != nil {
			if err := validateEffect(*body.Effect); err != nil {
				writeBadRequest(w, r, err.Error())
				return
			}
		}
		if body.TargetType != nil {
			if err := validateTargetType(*body.TargetType); err != nil {
				writeBadRequest(w, r, err.Error())
				return
			}
		}

		params := store.UpdateAccessPolicyParams{
			Name:        body.Name,
			Description: body.Description,
			Priority:    body.Priority,
			Enabled:     body.Enabled,
		}
		if body.Effect != nil {
			eff := store.AccessPolicyEffect(*body.Effect)
			params.Effect = &eff
		}
		if body.TargetType != nil {
			tt := store.AccessPolicyTargetType(*body.TargetType)
			params.TargetType = &tt
		}
		if body.TargetIDs != nil {
			ids := *body.TargetIDs
			if ids == nil {
				ids = []string{}
			}
			params.TargetIDs = &ids
		}
		if body.Conditions != nil {
			conds := conditionsFromDTO(*body.Conditions)
			params.Conditions = &conds
		}

		ctx := r.Context()
		var updated *store.AccessPolicy
		if err := withWriteTx(ctx, st, func(tx store.Tx) error {
			out, err := tx.UpdateAccessPolicy(ctx, id, params)
			if err != nil {
				return err
			}
			updated = out
			return nil
		}); err != nil {
			if errors.Is(err, store.ErrAccessPolicyNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeValidation, "Not found",
					"Access policy not found.", r.URL.Path, nil)
				return
			}
			if errors.Is(err, store.ErrAccessPolicyDuplicate) {
				writeProblem(w, http.StatusConflict, errTypeValidation, "Conflict",
					"An access policy with that name already exists.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update access policy")
			return
		}
		writeJSON(w, http.StatusOK, toDTO(updated))
	}
}

func handleDeleteAccessPolicy(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		ctx := r.Context()
		if err := withWriteTx(ctx, st, func(tx store.Tx) error {
			return tx.DeleteAccessPolicy(ctx, id)
		}); err != nil {
			if errors.Is(err, store.ErrAccessPolicyNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeValidation, "Not found",
					"Access policy not found.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete access policy")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ─── Tx helpers ─────────────────────────────────────────────────────────────

// withReadTx opens a read-only Tx, runs `fn`, and rolls back. The Tx isn't
// committed because no writes happen — Rollback is the cheap path.
func withReadTx[T any](ctx context.Context, st store.Driver, fn func(tx store.Tx) (T, error)) (T, error) {
	var zero T
	tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return zero, err
	}
	defer func() { _ = tx.Rollback() }()
	return fn(tx)
}

// withWriteTx opens a write Tx, runs `fn`, then commits or rolls back based
// on whether `fn` errored.
func withWriteTx(ctx context.Context, st store.Driver, fn func(tx store.Tx) error) error {
	tx, err := st.Begin(ctx, store.TxOptions{})
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
