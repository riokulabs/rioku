// Package gateway: tenant + membership REST endpoints (stage-2).
//
// Routes:
//
//	GET    /api/v1/admin/tenants            list every tenant       admin:cross-tenant-read
//	POST   /api/v1/admin/tenants            create tenant            admin:cross-tenant-write
//	GET    /api/v1/admin/tenants/{id}       get tenant detail        admin:cross-tenant-read
//	PATCH  /api/v1/admin/tenants/{id}       update tenant            admin:cross-tenant-write
//	DELETE /api/v1/admin/tenants/{id}       delete tenant            admin:cross-tenant-write
//
//	GET    /api/v1/t/{tenant}/settings/tenant       current tenant   tenant:read
//	PATCH  /api/v1/t/{tenant}/settings/tenant       partial update   tenant:write
//
//	GET    /api/v1/t/{tenant}/memberships           list members     user:read
//	POST   /api/v1/t/{tenant}/memberships           invite user      user:invite
//	GET    /api/v1/t/{tenant}/memberships/{id}      membership detail user:read
//	PATCH  /api/v1/t/{tenant}/memberships/{id}      state change     user:invite
//	DELETE /api/v1/t/{tenant}/memberships/{id}      remove           user:disable
//	PUT    /api/v1/t/{tenant}/memberships/{id}/roles  set roles      role:write
//
// All `/api/v1/t/{tenant}/...` routes assume TenantMiddleware has
// already resolved the tenant; handlers pull it from context.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterTenantRoutes wires tenant + membership endpoints into the mux.
func RegisterTenantRoutes(mux *http.ServeMux, st store.Driver) {
	// Admin (cross-tenant) — list/create/get/update/delete tenants.
	mux.Handle("GET /api/v1/admin/tenants",
		RequirePermission("admin:cross-tenant-read")(http.HandlerFunc(handleListTenants(st))))
	mux.Handle("POST /api/v1/admin/tenants",
		RequirePermission("admin:cross-tenant-write")(http.HandlerFunc(handleCreateTenant(st))))
	mux.Handle("GET /api/v1/admin/tenants/{id}",
		RequirePermission("admin:cross-tenant-read")(http.HandlerFunc(handleGetTenant(st))))
	mux.Handle("PATCH /api/v1/admin/tenants/{id}",
		RequirePermission("admin:cross-tenant-write")(http.HandlerFunc(handleUpdateTenant(st))))
	mux.Handle("DELETE /api/v1/admin/tenants/{id}",
		RequirePermission("admin:cross-tenant-write")(http.HandlerFunc(handleDeleteTenant(st))))

	// Tenant-scoped — current tenant settings.
	mux.Handle("GET /api/v1/t/{tenant}/settings/tenant",
		RequirePermission("tenant:read")(http.HandlerFunc(handleGetCurrentTenant)))
	mux.Handle("PATCH /api/v1/t/{tenant}/settings/tenant",
		RequirePermission("tenant:write")(http.HandlerFunc(handleUpdateCurrentTenant(st))))

	// Tenant-scoped — memberships.
	mux.Handle("GET /api/v1/t/{tenant}/memberships",
		RequirePermission("user:read")(http.HandlerFunc(handleListMemberships(st))))
	mux.Handle("POST /api/v1/t/{tenant}/memberships",
		RequirePermission("user:invite")(http.HandlerFunc(handleCreateMembership(st))))
	mux.Handle("GET /api/v1/t/{tenant}/memberships/{id}",
		RequirePermission("user:read")(http.HandlerFunc(handleGetMembership(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/memberships/{id}",
		RequirePermission("user:invite")(http.HandlerFunc(handleUpdateMembershipState(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/memberships/{id}",
		RequirePermission("user:invite")(http.HandlerFunc(handleUpdateMembershipState(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/memberships/{id}",
		RequirePermission("user:disable")(http.HandlerFunc(handleDeleteMembership(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/memberships/{id}/roles",
		RequirePermission("role:write")(http.HandlerFunc(handleSetMembershipRoles(st))))

	// Membership state-machine action aliases. Each transitions a
	// membership to a fixed state via the same storage method the
	// PATCH endpoint uses, so audit trails are identical regardless
	// of which surface the caller hits.
	mux.Handle("POST /api/v1/t/{tenant}/memberships/{id}/activate",
		RequirePermission("user:invite")(http.HandlerFunc(handleMembershipTransition(st, "active"))))
	mux.Handle("POST /api/v1/t/{tenant}/memberships/{id}/deactivate",
		RequirePermission("user:invite")(http.HandlerFunc(handleMembershipTransition(st, "deactivated"))))

	optionsutil.Register(mux, "/api/v1/admin/tenants", []string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/admin/tenants/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/tenant", []string{"GET", "PUT", "PATCH"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/memberships", []string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/memberships/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/memberships/{id}/roles", []string{"PUT"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/memberships/{id}/activate", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/memberships/{id}/deactivate", []string{"POST"})
}

// handleMembershipTransition POST-transitions a membership to the
// supplied state via the same storage path used by PATCH so audit
// records are uniform.
func handleMembershipTransition(st store.Driver, targetState string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		current, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Membership not found", "No membership with id "+id, r.URL.Path, nil)
			return
		}
		if current.TenantID != tenant.ID {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Membership not found", "No membership with id "+id, r.URL.Path, nil)
			return
		}
		updated, err := tx.UpdateMembershipState(r.Context(), id, targetState)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusUnprocessableEntity, errTypeUnprocess,
				"Invalid state transition", err.Error(), r.URL.Path, nil)
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, membershipToResponse(updated))
	}
}

// ─── Tenant DTOs ────────────────────────────────────────────────────────────

type tenantResponse struct {
	ID                 string  `json:"id"`
	Slug               string  `json:"slug"`
	Name               string  `json:"name"`
	Plan               string  `json:"plan"`
	URLMode            string  `json:"urlMode"`
	Accent             *string `json:"accent,omitempty"`
	LogoURL            *string `json:"logoUrl,omitempty"`
	DefaultDashboardID *string `json:"defaultDashboardId,omitempty"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
}

func tenantToResponse(t *store.Tenant) tenantResponse {
	return tenantResponse{
		ID:                 t.ID,
		Slug:               t.Slug,
		Name:               t.Name,
		Plan:               t.Plan,
		URLMode:            t.URLMode,
		Accent:             t.Accent,
		LogoURL:            t.LogoURL,
		DefaultDashboardID: t.DefaultDashboardID,
		CreatedAt:          t.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:          t.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type createTenantRequest struct {
	Slug    string `json:"slug"`
	Name    string `json:"name"`
	Plan    string `json:"plan,omitempty"`
	URLMode string `json:"urlMode,omitempty"`
}

type updateTenantRequest struct {
	Name               *string `json:"name,omitempty"`
	Plan               *string `json:"plan,omitempty"`
	URLMode            *string `json:"urlMode,omitempty"`
	Accent             *string `json:"accent,omitempty"`
	LogoURL            *string `json:"logoUrl,omitempty"`
	DefaultDashboardID *string `json:"defaultDashboardId,omitempty"`
}

// ─── Admin (cross-tenant) handlers ──────────────────────────────────────────

func handleListTenants(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		tenants, err := tx.ListTenants(r.Context())
		if err != nil {
			writeInternalError(w, r, "list tenants")
			return
		}
		out := make([]tenantResponse, 0, len(tenants))
		for _, t := range tenants {
			out = append(out, tenantToResponse(t))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateTenant(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createTenantRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Slug == "" || req.Name == "" {
			writeBadRequest(w, r, "slug and name are required")
			return
		}

		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		created, err := tx.CreateTenant(r.Context(), &store.Tenant{
			Slug: req.Slug, Name: req.Name, Plan: req.Plan, URLMode: req.URLMode,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrTenantSlugTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict,
					"Slug already in use",
					"A tenant with that slug already exists", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create tenant")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, tenantToResponse(created))
	}
}

func handleGetTenant(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		tenant, err := tx.GetTenant(r.Context(), id)
		if err != nil {
			if errors.Is(err, store.ErrTenantNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Tenant not found", "No tenant with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get tenant")
			return
		}
		writeJSON(w, http.StatusOK, tenantToResponse(tenant))
	}
}

func handleUpdateTenant(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var req updateTenantRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		updated, err := tx.UpdateTenant(r.Context(), id, store.UpdateTenantParams{
			Name:               req.Name,
			Plan:               req.Plan,
			URLMode:            req.URLMode,
			Accent:             req.Accent,
			LogoURL:            req.LogoURL,
			DefaultDashboardID: req.DefaultDashboardID,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrTenantNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Tenant not found", "No tenant with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update tenant")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, tenantToResponse(updated))
	}
}

func handleDeleteTenant(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		if err := tx.DeleteTenant(r.Context(), id); err != nil {
			_ = tx.Rollback()
			switch {
			case errors.Is(err, store.ErrTenantNotFound):
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Tenant not found", "No tenant with id "+id, r.URL.Path, nil)
			case errors.Is(err, store.ErrTenantImmutable):
				writeProblem(w, http.StatusForbidden, errTypeForbidden,
					"Default tenant cannot be deleted",
					"The default tenant is immutable. Create a new tenant for isolation instead.",
					r.URL.Path, nil)
			default:
				writeInternalError(w, r, "delete tenant")
			}
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ─── Tenant-scoped current-tenant settings ──────────────────────────────────

func handleGetCurrentTenant(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantOrError(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, tenantToResponse(tenant))
}

func handleUpdateCurrentTenant(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req updateTenantRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		updated, err := tx.UpdateTenant(r.Context(), tenant.ID, store.UpdateTenantParams{
			Name:               req.Name,
			Plan:               req.Plan,
			URLMode:            req.URLMode,
			Accent:             req.Accent,
			LogoURL:            req.LogoURL,
			DefaultDashboardID: req.DefaultDashboardID,
		})
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "update tenant")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, tenantToResponse(updated))
	}
}

// ─── Membership DTOs + handlers ─────────────────────────────────────────────

type membershipResponse struct {
	ID        string  `json:"id"`
	TenantID  string  `json:"tenantId"`
	UserID    string  `json:"userId"`
	State     string  `json:"state"`
	InvitedBy *string `json:"invitedBy,omitempty"`
	InvitedAt *string `json:"invitedAt,omitempty"`
	JoinedAt  *string `json:"joinedAt,omitempty"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
}

func membershipToResponse(m *store.Membership) membershipResponse {
	resp := membershipResponse{
		ID:        m.ID,
		TenantID:  m.TenantID,
		UserID:    m.UserID,
		State:     m.State,
		InvitedBy: m.InvitedBy,
		CreatedAt: m.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: m.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if m.InvitedAt != nil {
		s := m.InvitedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		resp.InvitedAt = &s
	}
	if m.JoinedAt != nil {
		s := m.JoinedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		resp.JoinedAt = &s
	}
	return resp
}

type createMembershipRequest struct {
	UserID string `json:"userId"`
	State  string `json:"state,omitempty"` // defaults to "pending"
}

type updateMembershipStateRequest struct {
	State string `json:"state"`
}

type setMembershipRolesRequest struct {
	RoleIDs []string `json:"roleIds"`
}

func handleListMemberships(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		memberships, err := tx.ListMembershipsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list memberships")
			return
		}
		out := make([]membershipResponse, 0, len(memberships))
		for _, m := range memberships {
			out = append(out, membershipToResponse(m))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateMembership(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req createMembershipRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.UserID == "" {
			writeBadRequest(w, r, "userId is required")
			return
		}
		state := req.State
		if state == "" {
			state = "pending"
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		created, err := tx.CreateMembership(r.Context(), &store.Membership{
			TenantID: tenant.ID,
			UserID:   req.UserID,
			State:    state,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrMembershipExists) {
				writeProblem(w, http.StatusConflict, errTypeConflict,
					"Membership already exists",
					"That user already has a membership in this tenant", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create membership")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, membershipToResponse(created))
	}
}

func handleGetMembership(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		m, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			if errors.Is(err, store.ErrMembershipNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Membership not found", "No membership with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get membership")
			return
		}
		// Cross-tenant guard: refuse to leak a membership from a
		// different tenant via a guessed id.
		if m.TenantID != tenant.ID {
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Membership not found", "No membership with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, membershipToResponse(m))
	}
}

func handleUpdateMembershipState(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		var req updateMembershipStateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.State == "" {
			writeBadRequest(w, r, "state is required")
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		// Cross-tenant guard.
		current, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Membership not found", "No membership with id "+id, r.URL.Path, nil)
			return
		}
		if current.TenantID != tenant.ID {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Membership not found", "No membership with id "+id, r.URL.Path, nil)
			return
		}
		updated, err := tx.UpdateMembershipState(r.Context(), id, req.State)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrMembershipInvalidState) {
				writeProblem(w, http.StatusConflict, errTypeConflict,
					"Invalid state transition",
					"Cannot transition from "+current.State+" to "+req.State, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update membership")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, membershipToResponse(updated))
	}
}

func handleDeleteMembership(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		current, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Membership not found", "No membership with id "+id, r.URL.Path, nil)
			return
		}
		if current.TenantID != tenant.ID {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Membership not found", "No membership with id "+id, r.URL.Path, nil)
			return
		}
		if err := tx.DeleteMembership(r.Context(), id); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "delete membership")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetMembershipRoles replaces a membership's role set with the
// supplied list. Implemented as: list current → diff → assign new → revoke removed.
// The transaction guarantees atomicity: if any step fails the whole
// replacement rolls back.
func handleSetMembershipRoles(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		var req setMembershipRolesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		current, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Membership not found", "No membership with id "+id, r.URL.Path, nil)
			return
		}
		if current.TenantID != tenant.ID {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Membership not found", "No membership with id "+id, r.URL.Path, nil)
			return
		}

		// Compute add/remove sets.
		existing, err := tx.ListMembershipRoles(r.Context(), id)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "list current roles")
			return
		}
		want := make(map[string]struct{}, len(req.RoleIDs))
		for _, rid := range req.RoleIDs {
			want[rid] = struct{}{}
		}
		have := make(map[string]struct{}, len(existing))
		for _, role := range existing {
			have[role.ID] = struct{}{}
		}

		grantedBy := ""
		for rid := range want {
			if _, ok := have[rid]; ok {
				continue
			}
			if err := tx.AssignMembershipRole(r.Context(), id, rid, grantedBy); err != nil {
				_ = tx.Rollback()
				writeInternalError(w, r, "assign role")
				return
			}
		}
		for rid := range have {
			if _, ok := want[rid]; ok {
				continue
			}
			if err := tx.RevokeMembershipRole(r.Context(), id, rid); err != nil {
				_ = tx.Rollback()
				writeInternalError(w, r, "revoke role")
				return
			}
		}

		updatedRoles, err := tx.ListMembershipRoles(r.Context(), id)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "list updated roles")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		// Surface roleIds (not full role objects) — the admin panel
		// only needs the list to reconcile state.
		roleIDs := make([]string, 0, len(updatedRoles))
		for _, role := range updatedRoles {
			roleIDs = append(roleIDs, role.ID)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"membershipId": id,
			"roleIds":      roleIDs,
		})
	}
}
