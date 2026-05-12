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
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterAccessPolicyRoutes registers the access policy CRUD endpoints.
// Both legacy `/api/v1/auth/access-policies` and the tenant-scoped
// `/api/v1/t/{tenant}/access-policies` are exposed. Storage filters by
// tenant_id from the request context, so the legacy form operates on
// the default tenant while the tenant-scoped form follows the URL slug.
func RegisterAccessPolicyRoutes(mux *http.ServeMux, st store.Driver) {
	list := RequirePermission("access-policies:read")(rerr.H(handleListAccessPolicies(st)))
	create := RequirePermission("access-policies:write")(rerr.H(handleCreateAccessPolicy(st)))
	get := RequirePermission("access-policies:read")(rerr.H(handleGetAccessPolicy(st)))
	update := RequirePermission("access-policies:write")(rerr.H(handleUpdateAccessPolicy(st)))
	del := RequirePermission("access-policies:write")(rerr.H(handleDeleteAccessPolicy(st)))

	mux.Handle("GET /api/v1/auth/access-policies", list)
	mux.Handle("POST /api/v1/auth/access-policies", create)
	mux.Handle("GET /api/v1/auth/access-policies/{id}", get)
	mux.Handle("PUT /api/v1/auth/access-policies/{id}", update)
	mux.Handle("PATCH /api/v1/auth/access-policies/{id}", update)
	mux.Handle("DELETE /api/v1/auth/access-policies/{id}", del)

	mux.Handle("GET /api/v1/t/{tenant}/access-policies", list)
	mux.Handle("POST /api/v1/t/{tenant}/access-policies", create)
	mux.Handle("GET /api/v1/t/{tenant}/access-policies/{id}", get)
	mux.Handle("PUT /api/v1/t/{tenant}/access-policies/{id}", update)
	mux.Handle("PATCH /api/v1/t/{tenant}/access-policies/{id}", update)
	mux.Handle("DELETE /api/v1/t/{tenant}/access-policies/{id}", del)

	// Test-CEL endpoint: compiles and evaluates a CEL expression against a
	// sample event using `github.com/google/cel-go`. Returns
	// `{ matched, error?, durationMs }`.
	testCEL := RequirePermission("access-policies:read")(rerr.H(handleTestAccessPolicyCEL()))
	mux.Handle("POST /api/v1/t/{tenant}/access-policies/test-cel", testCEL)
	optionsutil.Register(mux, "/api/v1/t/{tenant}/access-policies/test-cel",
		[]string{"POST"})

	optionsutil.Register(mux, "/api/v1/auth/access-policies",
		[]string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/auth/access-policies/{id}",
		[]string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/access-policies",
		[]string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/access-policies/{id}",
		[]string{"GET", "PUT", "PATCH", "DELETE"})
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

func handleListAccessPolicies(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		policies, err := withReadTx(ctx, st, func(tx store.Tx) ([]*store.AccessPolicy, error) {
			return tx.ListAccessPolicies(ctx)
		})
		if err != nil {
			return rerr.Wrap(err, "list access policies")
		}
		dtos := make([]accessPolicyDTO, len(policies))
		for i, p := range policies {
			dtos[i] = toDTO(p)
		}
		// OpenAPI: ListAccessPolicies200 = `{accessPolicies: [...], nextPageToken: ""}`.
		// The legacy `{items, total}` shape made the SPA's
		// `useAccessPolicyList` read `data.data.accessPolicies → undefined → []`
		// so the page rendered empty across every tenant.
		return rerr.JSON(w, map[string]any{
			"accessPolicies": dtos,
			"nextPageToken":  "",
		})
	}
}

func handleCreateAccessPolicy(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var body createPolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if body.Name == "" {
			return rerr.Validation(map[string]string{"name": "name is required"})
		}
		if err := validateEffect(body.Effect); err != nil {
			return rerr.Validation(map[string]string{"effect": err.Error()})
		}
		if err := validateTargetType(body.TargetType); err != nil {
			return rerr.Validation(map[string]string{"targetType": err.Error()})
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
				return rerr.Conflict("an access policy with that name already exists", err)
			}
			return rerr.Wrap(err, "create access policy")
		}
		w.WriteHeader(http.StatusCreated)
		return rerr.JSON(w, toDTO(created))
	}
}

func handleGetAccessPolicy(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		ctx := r.Context()
		policy, err := withReadTx(ctx, st, func(tx store.Tx) (*store.AccessPolicy, error) {
			return tx.GetAccessPolicy(ctx, id)
		})
		if err != nil {
			if errors.Is(err, store.ErrAccessPolicyNotFound) {
				return rerr.NotFound("access_policy", id)
			}
			return rerr.Wrap(err, "get access policy")
		}
		return rerr.JSON(w, toDTO(policy))
	}
}

func handleUpdateAccessPolicy(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		var body updatePolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if body.Effect != nil {
			if err := validateEffect(*body.Effect); err != nil {
				return rerr.Validation(map[string]string{"effect": err.Error()})
			}
		}
		if body.TargetType != nil {
			if err := validateTargetType(*body.TargetType); err != nil {
				return rerr.Validation(map[string]string{"targetType": err.Error()})
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
				return rerr.NotFound("access_policy", id)
			}
			if errors.Is(err, store.ErrAccessPolicyDuplicate) {
				return rerr.Conflict("an access policy with that name already exists", err)
			}
			return rerr.Wrap(err, "update access policy")
		}
		return rerr.JSON(w, toDTO(updated))
	}
}

func handleDeleteAccessPolicy(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		ctx := r.Context()
		if err := withWriteTx(ctx, st, func(tx store.Tx) error {
			return tx.DeleteAccessPolicy(ctx, id)
		}); err != nil {
			if errors.Is(err, store.ErrAccessPolicyNotFound) {
				return rerr.NotFound("access_policy", id)
			}
			return rerr.Wrap(err, "delete access policy")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
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
