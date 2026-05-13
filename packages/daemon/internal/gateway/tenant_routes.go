// Package gateway: tenant + membership REST endpoints.
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
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterTenantRoutes wires tenant + membership endpoints into the mux.
func RegisterTenantRoutes(mux *http.ServeMux, st store.Driver) {
	// Admin (cross-tenant) — list/create/get/update/delete tenants.
	mux.Handle("GET /api/v1/admin/tenants",
		RequirePermission("admin:cross-tenant-read")(rerr.H(handleListTenants(st))))
	mux.Handle("POST /api/v1/admin/tenants",
		RequirePermission("admin:cross-tenant-write")(rerr.H(handleCreateTenant(st))))
	mux.Handle("GET /api/v1/admin/tenants/{id}",
		RequirePermission("admin:cross-tenant-read")(rerr.H(handleGetTenant(st))))
	mux.Handle("PATCH /api/v1/admin/tenants/{id}",
		RequirePermission("admin:cross-tenant-write")(rerr.H(handleUpdateTenant(st))))
	mux.Handle("DELETE /api/v1/admin/tenants/{id}",
		RequirePermission("admin:cross-tenant-write")(rerr.H(handleDeleteTenant(st))))

	// Tenant-scoped — current tenant settings.
	mux.Handle("GET /api/v1/t/{tenant}/settings/tenant",
		RequirePermission("tenant:read")(rerr.H(handleGetCurrentTenant)))
	mux.Handle("PATCH /api/v1/t/{tenant}/settings/tenant",
		RequirePermission("tenant:write")(rerr.H(handleUpdateCurrentTenant(st))))

	// Tenant-scoped — memberships.
	mux.Handle("GET /api/v1/t/{tenant}/memberships",
		RequirePermission("user:read")(rerr.H(handleListMemberships(st))))
	mux.Handle("POST /api/v1/t/{tenant}/memberships",
		RequirePermission("user:invite")(rerr.H(handleCreateMembership(st))))
	mux.Handle("GET /api/v1/t/{tenant}/memberships/{id}",
		RequirePermission("user:read")(rerr.H(handleGetMembership(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/memberships/{id}",
		RequirePermission("user:invite")(rerr.H(handleUpdateMembershipState(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/memberships/{id}",
		RequirePermission("user:invite")(rerr.H(handleUpdateMembershipState(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/memberships/{id}",
		RequirePermission("user:disable")(rerr.H(handleDeleteMembership(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/memberships/{id}/roles",
		RequirePermission("role:write")(rerr.H(handleSetMembershipRoles(st))))

	// Membership state-machine action aliases. Each transitions a
	// membership to a fixed state via the same storage method the
	// PATCH endpoint uses, so audit trails are identical regardless
	// of which surface the caller hits.
	mux.Handle("POST /api/v1/t/{tenant}/memberships/{id}/activate",
		RequirePermission("user:invite")(rerr.H(handleMembershipTransition(st, "active"))))
	mux.Handle("POST /api/v1/t/{tenant}/memberships/{id}/deactivate",
		RequirePermission("user:invite")(rerr.H(handleMembershipTransition(st, "deactivated"))))

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
func handleMembershipTransition(st store.Driver, targetState string) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		current, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			return rerr.NotFound("membership", id)
		}
		if current.TenantID != tenant.ID {
			return rerr.NotFound("membership", id)
		}
		updated, err := tx.UpdateMembershipState(r.Context(), id, targetState)
		if err != nil {
			return rerr.Wrap(err, "update membership state")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, membershipToResponse(updated))
	}
}

// ─── Tenant DTOs ────────────────────────────────────────────────────────────

type tenantResponse struct {
	ID                 string  `json:"id"`
	Slug               string  `json:"slug"`
	Name               string  `json:"name"`
	Plan               string  `json:"plan"`
	URLMode            string  `json:"urlMode"`
	ParentDomain       string  `json:"parentDomain,omitempty"`
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
		ParentDomain:       t.ParentDomain,
		Accent:             t.Accent,
		LogoURL:            t.LogoURL,
		DefaultDashboardID: t.DefaultDashboardID,
		CreatedAt:          t.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:          t.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type createTenantRequest struct {
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	Plan         string `json:"plan,omitempty"`
	URLMode      string `json:"urlMode,omitempty"`
	ParentDomain string `json:"parentDomain,omitempty"`
}

type updateTenantRequest struct {
	Name               *string `json:"name,omitempty"`
	Plan               *string `json:"plan,omitempty"`
	URLMode            *string `json:"urlMode,omitempty"`
	ParentDomain       *string `json:"parentDomain,omitempty"`
	Accent             *string `json:"accent,omitempty"`
	LogoURL            *string `json:"logoUrl,omitempty"`
	DefaultDashboardID *string `json:"defaultDashboardId,omitempty"`
}

// ─── Admin (cross-tenant) handlers ──────────────────────────────────────────

func handleListTenants(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		tenants, err := tx.ListTenants(r.Context())
		if err != nil {
			return rerr.Wrap(err, "list tenants")
		}
		out := make([]tenantResponse, 0, len(tenants))
		for _, t := range tenants {
			out = append(out, tenantToResponse(t))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateTenant(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var req createTenantRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Slug == "" || req.Name == "" {
			return rerr.Validation(map[string]string{"slug": "slug and name are required"})
		}

		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		created, err := tx.CreateTenant(r.Context(), &store.Tenant{
			Slug: req.Slug, Name: req.Name, Plan: req.Plan, URLMode: req.URLMode, ParentDomain: req.ParentDomain,
		})
		if err != nil {
			if errors.Is(err, store.ErrTenantSlugTaken) {
				return rerr.Conflict("A tenant with that slug already exists", err)
			}
			return rerr.Wrap(err, "create tenant")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, tenantToResponse(created))
	}
}

func handleGetTenant(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		tenant, err := tx.GetTenant(r.Context(), id)
		if err != nil {
			if errors.Is(err, store.ErrTenantNotFound) {
				return rerr.NotFound("tenant", id)
			}
			return rerr.Wrap(err, "get tenant")
		}
		return rerr.JSON(w, tenantToResponse(tenant))
	}
}

func handleUpdateTenant(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		var req updateTenantRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		updated, err := tx.UpdateTenant(r.Context(), id, store.UpdateTenantParams{
			Name:               req.Name,
			Plan:               req.Plan,
			URLMode:            req.URLMode,
			ParentDomain:       req.ParentDomain,
			Accent:             req.Accent,
			LogoURL:            req.LogoURL,
			DefaultDashboardID: req.DefaultDashboardID,
		})
		if err != nil {
			if errors.Is(err, store.ErrTenantNotFound) {
				return rerr.NotFound("tenant", id)
			}
			return rerr.Wrap(err, "update tenant")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, tenantToResponse(updated))
	}
}

func handleDeleteTenant(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		if err := tx.DeleteTenant(r.Context(), id); err != nil {
			switch {
			case errors.Is(err, store.ErrTenantNotFound):
				return rerr.NotFound("tenant", id)
			case errors.Is(err, store.ErrTenantImmutable):
				return rerr.Forbidden("The default tenant is immutable. Create a new tenant for isolation instead.")
			default:
				return rerr.Wrap(err, "delete tenant")
			}
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ─── Tenant-scoped current-tenant settings ──────────────────────────────────

func handleGetCurrentTenant(w http.ResponseWriter, r *http.Request) error {
	tenant, ok := tenantOrError(w, r)
	if !ok {
		return nil
	}
	return rerr.JSON(w, tenantToResponse(tenant))
}

func handleUpdateCurrentTenant(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req updateTenantRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		updated, err := tx.UpdateTenant(r.Context(), tenant.ID, store.UpdateTenantParams{
			Name:               req.Name,
			Plan:               req.Plan,
			URLMode:            req.URLMode,
			ParentDomain:       req.ParentDomain,
			Accent:             req.Accent,
			LogoURL:            req.LogoURL,
			DefaultDashboardID: req.DefaultDashboardID,
		})
		if err != nil {
			return rerr.Wrap(err, "update tenant")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, tenantToResponse(updated))
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

func handleListMemberships(st store.Driver) rerr.Handler {
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
		memberships, err := tx.ListMembershipsByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list memberships")
		}
		out := make([]membershipResponse, 0, len(memberships))
		for _, m := range memberships {
			out = append(out, membershipToResponse(m))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateMembership(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req createMembershipRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.UserID == "" {
			return rerr.Validation(map[string]string{"userId": "userId is required"})
		}
		state := req.State
		if state == "" {
			state = "pending"
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		created, err := tx.CreateMembership(r.Context(), &store.Membership{
			TenantID: tenant.ID,
			UserID:   req.UserID,
			State:    state,
		})
		if err != nil {
			if errors.Is(err, store.ErrMembershipExists) {
				return rerr.Conflict("That user already has a membership in this tenant", err)
			}
			return rerr.Wrap(err, "create membership")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, membershipToResponse(created))
	}
}

func handleGetMembership(st store.Driver) rerr.Handler {
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
		m, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			if errors.Is(err, store.ErrMembershipNotFound) {
				return rerr.NotFound("membership", id)
			}
			return rerr.Wrap(err, "get membership")
		}
		// Cross-tenant guard: refuse to leak a membership from a
		// different tenant via a guessed id.
		if m.TenantID != tenant.ID {
			return rerr.NotFound("membership", id)
		}
		return rerr.JSON(w, membershipToResponse(m))
	}
}

func handleUpdateMembershipState(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req updateMembershipStateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.State == "" {
			return rerr.Validation(map[string]string{"state": "state is required"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		// Cross-tenant guard.
		current, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			return rerr.NotFound("membership", id)
		}
		if current.TenantID != tenant.ID {
			return rerr.NotFound("membership", id)
		}
		updated, err := tx.UpdateMembershipState(r.Context(), id, req.State)
		if err != nil {
			if errors.Is(err, store.ErrMembershipInvalidState) {
				return rerr.Conflict("Cannot transition from "+current.State+" to "+req.State, err)
			}
			return rerr.Wrap(err, "update membership")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, membershipToResponse(updated))
	}
}

func handleDeleteMembership(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		current, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			return rerr.NotFound("membership", id)
		}
		if current.TenantID != tenant.ID {
			return rerr.NotFound("membership", id)
		}
		if err := tx.DeleteMembership(r.Context(), id); err != nil {
			return rerr.Wrap(err, "delete membership")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// handleSetMembershipRoles replaces a membership's role set with the
// supplied list. Implemented as: list current → diff → assign new → revoke removed.
// The transaction guarantees atomicity: if any step fails the whole
// replacement rolls back.
func handleSetMembershipRoles(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req setMembershipRolesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		current, err := tx.GetMembership(r.Context(), id)
		if err != nil {
			return rerr.NotFound("membership", id)
		}
		if current.TenantID != tenant.ID {
			return rerr.NotFound("membership", id)
		}

		// Compute add/remove sets.
		existing, err := tx.ListMembershipRoles(r.Context(), id)
		if err != nil {
			return rerr.Wrap(err, "list current roles")
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
				return rerr.Wrap(err, "assign role")
			}
		}
		for rid := range have {
			if _, ok := want[rid]; ok {
				continue
			}
			if err := tx.RevokeMembershipRole(r.Context(), id, rid); err != nil {
				return rerr.Wrap(err, "revoke role")
			}
		}

		updatedRoles, err := tx.ListMembershipRoles(r.Context(), id)
		if err != nil {
			return rerr.Wrap(err, "list updated roles")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		// Surface roleIds (not full role objects) — the admin panel
		// only needs the list to reconcile state.
		roleIDs := make([]string, 0, len(updatedRoles))
		for _, role := range updatedRoles {
			roleIDs = append(roleIDs, role.ID)
		}
		return rerr.JSON(w, map[string]any{
			"membershipId": id,
			"roleIds":      roleIDs,
		})
	}
}
