// Package gateway: tenant-scoped RBAC policy CRUD. RBAC policies map
// subjects (user / group / service-account) to roles within a tenant.
// Distinct from access-policies (request-time conditional access) and
// the legacy proto Policy (handler config blob).
//
//	OPTIONS  /api/v1/t/{tenant}/rbac-policies                discovery
//	GET      /api/v1/t/{tenant}/rbac-policies                list                rbac:read
//	POST     /api/v1/t/{tenant}/rbac-policies                create              rbac:write
//	OPTIONS  /api/v1/t/{tenant}/rbac-policies/{id}           discovery
//	GET      /api/v1/t/{tenant}/rbac-policies/{id}           detail              rbac:read
//	PUT      /api/v1/t/{tenant}/rbac-policies/{id}           replace             rbac:write
//	PATCH    /api/v1/t/{tenant}/rbac-policies/{id}           partial             rbac:write
//	DELETE   /api/v1/t/{tenant}/rbac-policies/{id}           delete              rbac:write
//	POST     /api/v1/t/{tenant}/rbac-policies/{id}/test      dry-run check       rbac:read
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/gateway/links"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterRbacPolicyRoutes wires the rbac-policy CRUD surface.
func RegisterRbacPolicyRoutes(mux *http.ServeMux, st store.Driver) {
	list := RequirePermission("rbac:read")(rerr.H(handleListRbacPolicies(st)))
	create := RequirePermission("rbac:write")(rerr.H(handleCreateRbacPolicy(st)))
	get := RequirePermission("rbac:read")(rerr.H(handleGetRbacPolicy(st)))
	update := RequirePermission("rbac:write")(rerr.H(handleUpdateRbacPolicy(st)))
	del := RequirePermission("rbac:write")(rerr.H(handleDeleteRbacPolicy(st)))
	test := RequirePermission("rbac:read")(rerr.H(handleTestRbacPolicy(st)))

	mux.Handle("GET /api/v1/t/{tenant}/rbac-policies", list)
	mux.Handle("POST /api/v1/t/{tenant}/rbac-policies", create)
	mux.Handle("GET /api/v1/t/{tenant}/rbac-policies/{id}", get)
	mux.Handle("PUT /api/v1/t/{tenant}/rbac-policies/{id}", update)
	mux.Handle("PATCH /api/v1/t/{tenant}/rbac-policies/{id}", update)
	mux.Handle("DELETE /api/v1/t/{tenant}/rbac-policies/{id}", del)
	mux.Handle("POST /api/v1/t/{tenant}/rbac-policies/{id}/test", test)

	optionsutil.Register(mux, "/api/v1/t/{tenant}/rbac-policies",
		[]string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/rbac-policies/{id}",
		[]string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/rbac-policies/{id}/test",
		[]string{"POST"})
}

type rbacPolicyDTO struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenantId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	SubjectType string    `json:"subjectType"`
	SubjectID   string    `json:"subjectId"`
	RoleID      string    `json:"roleId"`
	Enabled     bool      `json:"enabled"`
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt"`
	Links       links.Set `json:"_links"`
}

func rbacPolicyToDTO(p *store.RbacPolicy, b *links.Builder) rbacPolicyDTO {
	dto := rbacPolicyDTO{
		ID:          p.ID,
		TenantID:    p.TenantID,
		Name:        p.Name,
		Description: p.Description,
		SubjectType: p.SubjectType,
		SubjectID:   p.SubjectID,
		RoleID:      p.RoleID,
		Enabled:     p.Enabled,
		CreatedAt:   p.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:   p.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		Links: links.Set{
			"self": b.Self("rbac-policies", p.ID),
			"role": b.Self("roles", p.RoleID),
			"test": b.Action("rbac-policies", p.ID, "test"),
		},
	}
	switch p.SubjectType {
	case "user":
		dto.Links["subject"] = b.Self("users", p.SubjectID)
	}
	return dto
}

type createRbacPolicyRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	SubjectType string `json:"subjectType"`
	SubjectID   string `json:"subjectId"`
	RoleID      string `json:"roleId"`
	Enabled     *bool  `json:"enabled,omitempty"`
}

type updateRbacPolicyRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	SubjectType *string `json:"subjectType,omitempty"`
	SubjectID   *string `json:"subjectId,omitempty"`
	RoleID      *string `json:"roleId,omitempty"`
	Enabled     *bool   `json:"enabled,omitempty"`
}

func handleListRbacPolicies(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		policies, err := tx.ListRbacPolicies(r.Context())
		if err != nil {
			return rerr.Wrap(err, "list rbac_policies")
		}
		b := links.NewTenantBuilder(tenant.Slug)
		out := make([]rbacPolicyDTO, 0, len(policies))
		for _, p := range policies {
			out = append(out, rbacPolicyToDTO(p, b))
		}
		// OpenAPI: ListRbacPolicies200 = `{rbacPolicies: [...], nextPageToken: ""}`.
		// The legacy `{items, total, _links}` shape made the SPA's
		// `useRbacPolicyList` read `data.data.rbacPolicies → undefined → []`
		// and render an empty list across every tenant.
		return rerr.JSON(w, map[string]any{
			"rbacPolicies":  out,
			"nextPageToken": "",
			"_links":        links.Set{"self": b.Collection("rbac-policies")},
		})
	}
}

func handleCreateRbacPolicy(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req createRbacPolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Name == "" || req.SubjectType == "" || req.SubjectID == "" || req.RoleID == "" {
			return rerr.Validation(map[string]string{"body": "name, subjectType, subjectId, and roleId are required"})
		}
		enabled := true
		if req.Enabled != nil {
			enabled = *req.Enabled
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		created, err := tx.CreateRbacPolicy(r.Context(), &store.RbacPolicy{
			Name:        req.Name,
			Description: req.Description,
			SubjectType: req.SubjectType,
			SubjectID:   req.SubjectID,
			RoleID:      req.RoleID,
			Enabled:     enabled,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrRbacPolicyDuplicate) {
				return rerr.Conflict("a policy mapping this subject to that role already exists", err)
			}
			return rerr.Validation(map[string]string{"body": err.Error()})
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, rbacPolicyToDTO(created, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleGetRbacPolicy(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		p, err := tx.GetRbacPolicy(r.Context(), id)
		if err != nil {
			return rerr.NotFound("rbac_policy", id)
		}
		return rerr.JSON(w, rbacPolicyToDTO(p, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleUpdateRbacPolicy(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req updateRbacPolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		updated, err := tx.UpdateRbacPolicy(r.Context(), id, store.UpdateRbacPolicyParams{
			Name:        req.Name,
			Description: req.Description,
			SubjectType: req.SubjectType,
			SubjectID:   req.SubjectID,
			RoleID:      req.RoleID,
			Enabled:     req.Enabled,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrRbacPolicyNotFound) {
				return rerr.NotFound("rbac_policy", id)
			}
			if errors.Is(err, store.ErrRbacPolicyDuplicate) {
				return rerr.Conflict("another policy already maps this subject to that role", err)
			}
			return rerr.Wrap(err, "update rbac_policy")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, rbacPolicyToDTO(updated, links.NewTenantBuilder(tenant.Slug)))
	}
}

func handleDeleteRbacPolicy(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		_ = TenantFromContext(r.Context())
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		if err := tx.DeleteRbacPolicy(r.Context(), id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrRbacPolicyNotFound) {
				return rerr.NotFound("rbac_policy", id)
			}
			return rerr.Wrap(err, "delete rbac_policy")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// handleTestRbacPolicy dry-runs the policy: given an `identitySubjectId`
// in the body, reports whether the policy would grant the role to that
// identity. Body shape:
//
//	{ "subjectId": "u_alice", "subjectType": "user" }
//
// If both fields match the policy AND the policy is enabled, returns
// `{ "matched": true, "roleId": "..." }`; else `{ "matched": false }`.
func handleTestRbacPolicy(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		_ = TenantFromContext(r.Context())
		id := r.PathValue("id")
		var req struct {
			SubjectID   string `json:"subjectId"`
			SubjectType string `json:"subjectType"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		p, err := tx.GetRbacPolicy(r.Context(), id)
		if err != nil {
			return rerr.NotFound("rbac_policy", id)
		}
		matched := p.Enabled && p.SubjectID == req.SubjectID && p.SubjectType == req.SubjectType
		out := map[string]any{
			"matched":  matched,
			"policyId": p.ID,
		}
		if matched {
			out["roleId"] = p.RoleID
		}
		return rerr.JSON(w, out)
	}
}
