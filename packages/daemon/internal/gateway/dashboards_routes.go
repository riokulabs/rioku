// Package gateway: Dashboards + Widgets + Versions REST endpoints (stage-2).
//
// Routes (per the admin panel mock):
//
//	GET    /api/v1/t/{tenant}/dashboards                      list
//	POST   /api/v1/t/{tenant}/dashboards                      create
//	GET    /api/v1/t/{tenant}/dashboards/{id}                 detail
//	PUT    /api/v1/t/{tenant}/dashboards/{id}                 update
//	DELETE /api/v1/t/{tenant}/dashboards/{id}                 delete
//	GET    /api/v1/t/{tenant}/dashboards/{id}/widgets         list widgets
//	GET    /api/v1/t/{tenant}/dashboards/{id}/versions        list versions
//	POST   /api/v1/t/{tenant}/dashboards/{id}/set-default     set tenant default
//	POST   /api/v1/t/{tenant}/dashboards/{id}/set-home        per-user home flag
//	POST   /api/v1/t/{tenant}/dashboards/{id}/snapshot        new version
//	POST   /api/v1/t/{tenant}/dashboards/versions/{vid}/restore  restore
//	GET    /api/v1/t/{tenant}/dashboards/{id}/export          export JSON
//	POST   /api/v1/t/{tenant}/dashboards/import               import JSON
//	POST   /api/v1/t/{tenant}/dashboards/{id}/widgets         add widget
//	PUT    /api/v1/t/{tenant}/widgets/{id}                    update widget
//	DELETE /api/v1/t/{tenant}/dashboards/{id}/widgets/{wid}   remove widget
//	PUT    /api/v1/t/{tenant}/dashboards/{id}/layout          bulk layout update
//	POST   /api/v1/t/{tenant}/widgets/{id}/flip-advanced      lock advanced
//	POST   /api/v1/t/{tenant}/widgets/{id}/flip-wizard        unlock advanced
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/store"
)

func RegisterDashboardRoutes(mux *http.ServeMux, st store.Driver) {
	// Dashboards
	mux.Handle("GET /api/v1/t/{tenant}/dashboards",
		RequirePermission("dashboard:read")(http.HandlerFunc(handleListDashboards(st))))
	mux.Handle("POST /api/v1/t/{tenant}/dashboards",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleCreateDashboard(st))))
	mux.Handle("GET /api/v1/t/{tenant}/dashboards/{id}",
		RequirePermission("dashboard:read")(http.HandlerFunc(handleGetDashboard(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/dashboards/{id}",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleUpdateDashboard(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/dashboards/{id}",
		RequirePermission("dashboard:delete")(http.HandlerFunc(handleDeleteDashboard(st))))
	mux.Handle("POST /api/v1/t/{tenant}/dashboards/{id}/set-default",
		RequirePermission("dashboard:set-default")(http.HandlerFunc(handleSetDefaultDashboard(st))))
	mux.Handle("POST /api/v1/t/{tenant}/dashboards/{id}/set-home",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleSetDashboardHome(st))))

	// Widgets
	mux.Handle("GET /api/v1/t/{tenant}/dashboards/{id}/widgets",
		RequirePermission("dashboard:read")(http.HandlerFunc(handleListWidgets(st))))
	mux.Handle("POST /api/v1/t/{tenant}/dashboards/{id}/widgets",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleAddWidget(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/widgets/{id}",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleUpdateWidget(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/dashboards/{id}/widgets/{wid}",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleDeleteWidget(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/dashboards/{id}/layout",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleUpdateLayout(st))))
	mux.Handle("POST /api/v1/t/{tenant}/widgets/{id}/flip-advanced",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleFlipWidget(st, true))))
	mux.Handle("POST /api/v1/t/{tenant}/widgets/{id}/flip-wizard",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleFlipWidget(st, false))))

	// Versions
	mux.Handle("GET /api/v1/t/{tenant}/dashboards/{id}/versions",
		RequirePermission("dashboard:read")(http.HandlerFunc(handleListVersions(st))))
	mux.Handle("POST /api/v1/t/{tenant}/dashboards/{id}/snapshot",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleSnapshotDashboard(st))))
	mux.Handle("POST /api/v1/t/{tenant}/dashboards/versions/{vid}/restore",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleRestoreDashboardVersion(st))))

	// Import/export
	mux.Handle("GET /api/v1/t/{tenant}/dashboards/{id}/export",
		RequirePermission("dashboard:read")(http.HandlerFunc(handleExportDashboard(st))))
	mux.Handle("POST /api/v1/t/{tenant}/dashboards/import",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleImportDashboard(st))))

	// PATCH aliases for the existing PUT handlers — semantics
	// identical at this layer (the PUT handler already accepts
	// pointer-field partial bodies); both verbs map to the same
	// closure so the OpenAPI advertises the canonical pair.
	mux.Handle("PATCH /api/v1/t/{tenant}/dashboards/{id}",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleUpdateDashboard(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/widgets/{id}",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleUpdateWidget(st))))

	// Sharing — POST creates a role grant; GET lists all grants for
	// the dashboard; DELETE revokes one grant by share id.
	mux.Handle("POST /api/v1/t/{tenant}/dashboards/{id}/share",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleShareDashboard(st))))
	mux.Handle("GET /api/v1/t/{tenant}/dashboards/{id}/shares",
		RequirePermission("dashboard:read")(http.HandlerFunc(handleListDashboardShares(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/dashboards/{id}/shares/{shareId}",
		RequirePermission("dashboard:write")(http.HandlerFunc(handleDeleteDashboardShare(st))))

	// OPTIONS coverage on the canonical dashboards/widgets paths.
	// The dashboards/versions/{vid}/restore POST endpoint occupies a
	// path shape that collides with several /dashboards/{id}/{action}
	// patterns in Go's ServeMux dispatcher, so we deliberately skip
	// OPTIONS on `versions/{vid}/restore` and on `{id}/import` to
	// avoid the route-conflict panic. Browsers don't preflight POST
	// without a custom header in any case; the action is reachable
	// directly via POST.
	optionsutil.Register(mux, "/api/v1/t/{tenant}/dashboards", []string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/dashboards/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/dashboards/{id}/widgets", []string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/dashboards/{id}/widgets/{wid}", []string{"DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/dashboards/{id}/shares", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/dashboards/{id}/shares/{shareId}", []string{"DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/widgets/{id}", []string{"PUT", "PATCH"})
}

// handleShareDashboard creates a share grant for the dashboard.
//
// Body: { "roleId": "role_xyz", "expiresAt": "2026-12-31T00:00:00Z" }
// (expiresAt optional). Returns the created share with `_links`.
func handleShareDashboard(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		dashboardID := r.PathValue("id")
		var req struct {
			RoleID    string  `json:"roleId"`
			ExpiresAt *string `json:"expiresAt,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.RoleID == "" {
			writeBadRequest(w, r, "roleId is required")
			return
		}

		share := &store.DashboardShare{
			DashboardID: dashboardID,
			RoleID:      req.RoleID,
		}
		if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil {
			uid := sc.UserID
			share.CreatedBy = &uid
		}
		if req.ExpiresAt != nil && *req.ExpiresAt != "" {
			t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
			if err != nil {
				writeBadRequest(w, r, "expiresAt must be RFC3339")
				return
			}
			share.ExpiresAt = &t
		}

		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		// Confirm the dashboard belongs to this tenant before creating the share.
		if _, err := tx.GetDashboard(r.Context(), tenant.ID, dashboardID); err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Dashboard not found", "No dashboard with id "+dashboardID, r.URL.Path, nil)
			return
		}
		created, err := tx.CreateDashboardShare(r.Context(), share)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusUnprocessableEntity, errTypeUnprocess,
				"Share failed", err.Error(), r.URL.Path, nil)
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, dashboardShareToResponse(created, tenant.Slug))
	}
}

func handleListDashboardShares(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		dashboardID := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		shares, err := tx.ListDashboardShares(r.Context(), dashboardID)
		if err != nil {
			writeInternalError(w, r, "list shares")
			return
		}
		out := make([]map[string]any, 0, len(shares))
		for _, s := range shares {
			out = append(out, dashboardShareToResponse(s, tenant.Slug))
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": out,
			"total": len(out),
		})
	}
}

func handleDeleteDashboardShare(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = TenantFromContext(r.Context())
		shareID := r.PathValue("shareId")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		if err := tx.DeleteDashboardShare(r.Context(), shareID); err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Share not found", "No share with id "+shareID, r.URL.Path, nil)
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func dashboardShareToResponse(s *store.DashboardShare, tenantSlug string) map[string]any {
	out := map[string]any{
		"id":          s.ID,
		"tenantId":    s.TenantID,
		"dashboardId": s.DashboardID,
		"roleId":      s.RoleID,
		"createdAt":   s.CreatedAt.UTC().Format(time.RFC3339),
		"_links": map[string]any{
			"self":      map[string]any{"href": "/api/v1/t/" + tenantSlug + "/dashboards/" + s.DashboardID + "/shares/" + s.ID},
			"dashboard": map[string]any{"href": "/api/v1/t/" + tenantSlug + "/dashboards/" + s.DashboardID},
			"role":      map[string]any{"href": "/api/v1/t/" + tenantSlug + "/roles/" + s.RoleID},
		},
	}
	if s.CreatedBy != nil {
		out["createdBy"] = *s.CreatedBy
	}
	if s.ExpiresAt != nil {
		out["expiresAt"] = s.ExpiresAt.UTC().Format(time.RFC3339)
	}
	return out
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

type dashboardResponse struct {
	ID            string          `json:"id"`
	TenantID      string          `json:"tenantId"`
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	Mode          string          `json:"mode"`
	Scope         string          `json:"scope"`
	OwnerUserID   *string         `json:"ownerUserId,omitempty"`
	IsDefault     bool            `json:"isDefault"`
	SharedRoleIDs json.RawMessage `json:"sharedRoleIds"`
	HomeForUsers  json.RawMessage `json:"homeForUsers"`
	Variables     json.RawMessage `json:"variables"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt"`
}

func dashboardToResponse(d *store.Dashboard) dashboardResponse {
	return dashboardResponse{
		ID:            d.ID,
		TenantID:      d.TenantID,
		Name:          d.Name,
		Description:   d.Description,
		Mode:          d.Mode,
		Scope:         d.Scope,
		OwnerUserID:   d.OwnerUserID,
		IsDefault:     d.IsDefault,
		SharedRoleIDs: rawOrEmpty(d.SharedRoleIDs, "[]"),
		HomeForUsers:  rawOrEmpty(d.HomeForUsers, "[]"),
		Variables:     rawOrEmpty(d.Variables, "[]"),
		CreatedAt:     d.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:     d.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type widgetResponse struct {
	ID             string          `json:"id"`
	DashboardID    string          `json:"dashboardId"`
	Kind           string          `json:"kind"`
	Title          string          `json:"title"`
	DataSource     string          `json:"dataSource"`
	Config         json.RawMessage `json:"config"`
	RawQuery       *string         `json:"rawQuery,omitempty"`
	LockedAdvanced bool            `json:"lockedAdvanced"`
	Layout         json.RawMessage `json:"layout"`
	CreatedAt      string          `json:"createdAt"`
	UpdatedAt      string          `json:"updatedAt"`
}

func widgetToResponse(w *store.Widget) widgetResponse {
	return widgetResponse{
		ID:             w.ID,
		DashboardID:    w.DashboardID,
		Kind:           w.Kind,
		Title:          w.Title,
		DataSource:     w.DataSource,
		Config:         rawOrEmpty(w.Config, "{}"),
		RawQuery:       w.RawQuery,
		LockedAdvanced: w.LockedAdvanced,
		Layout:         rawOrEmpty(w.Layout, `{"x":0,"y":0,"w":4,"h":3}`),
		CreatedAt:      w.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:      w.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type versionResponse struct {
	ID           string          `json:"id"`
	DashboardID  string          `json:"dashboardId"`
	Version      int32           `json:"version"`
	CreatedBy    *string         `json:"createdBy,omitempty"`
	CreatedAt    string          `json:"createdAt"`
	Note         string          `json:"note"`
	SnapshotJSON json.RawMessage `json:"snapshot"`
}

func versionToResponse(v *store.DashboardVersion) versionResponse {
	return versionResponse{
		ID:           v.ID,
		DashboardID:  v.DashboardID,
		Version:      v.Version,
		CreatedBy:    v.CreatedBy,
		CreatedAt:    v.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		Note:         v.Note,
		SnapshotJSON: json.RawMessage(v.SnapshotJSON),
	}
}

func rawOrEmpty(s, fallback string) json.RawMessage {
	if s == "" {
		return json.RawMessage(fallback)
	}
	return json.RawMessage(s)
}

// ─── Dashboard handlers ─────────────────────────────────────────────────────

type createDashboardRequest struct {
	Name          string          `json:"name"`
	Description   string          `json:"description,omitempty"`
	Mode          string          `json:"mode,omitempty"`
	Scope         string          `json:"scope,omitempty"`
	SharedRoleIDs json.RawMessage `json:"sharedRoleIds,omitempty"`
	Variables     json.RawMessage `json:"variables,omitempty"`
}

type updateDashboardRequest struct {
	Name          *string          `json:"name,omitempty"`
	Description   *string          `json:"description,omitempty"`
	Mode          *string          `json:"mode,omitempty"`
	Scope         *string          `json:"scope,omitempty"`
	SharedRoleIDs *json.RawMessage `json:"sharedRoleIds,omitempty"`
	Variables     *json.RawMessage `json:"variables,omitempty"`
}

func handleListDashboards(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		dashboards, err := tx.ListDashboardsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list dashboards")
			return
		}
		out := make([]dashboardResponse, 0, len(dashboards))
		for _, d := range dashboards {
			out = append(out, dashboardToResponse(d))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateDashboard(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		var req createDashboardRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" {
			writeBadRequest(w, r, "name is required")
			return
		}
		var ownerID *string
		if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil && sc.UserID != "" {
			id := sc.UserID
			ownerID = &id
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateDashboard(r.Context(), &store.Dashboard{
			TenantID:      tenant.ID,
			Name:          req.Name,
			Description:   req.Description,
			Mode:          req.Mode,
			Scope:         req.Scope,
			OwnerUserID:   ownerID,
			SharedRoleIDs: string(req.SharedRoleIDs),
			Variables:     string(req.Variables),
		})
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "create dashboard")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, dashboardToResponse(created))
	}
}

func handleGetDashboard(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		d, err := tx.GetDashboard(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrDashboardNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Dashboard not found", "No dashboard with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get dashboard")
			return
		}
		writeJSON(w, http.StatusOK, dashboardToResponse(d))
	}
}

func handleUpdateDashboard(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		var req updateDashboardRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		params := store.UpdateDashboardParams{
			Name:        req.Name,
			Description: req.Description,
			Mode:        req.Mode,
			Scope:       req.Scope,
		}
		if req.SharedRoleIDs != nil {
			s := string(*req.SharedRoleIDs)
			params.SharedRoleIDs = &s
		}
		if req.Variables != nil {
			s := string(*req.Variables)
			params.Variables = &s
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateDashboard(r.Context(), tenant.ID, id, params)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrDashboardNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Dashboard not found", "No dashboard with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update dashboard")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, dashboardToResponse(updated))
	}
}

func handleDeleteDashboard(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteDashboard(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrDashboardNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Dashboard not found", "No dashboard with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete dashboard")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleSetDefaultDashboard(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.SetDefaultDashboard(r.Context(), tenant.ID, id)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrDashboardNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Dashboard not found", "No dashboard with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "set default")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, dashboardToResponse(updated))
	}
}

func handleSetDashboardHome(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		sc := auth.SessionClaimsFromContext(r.Context())
		if sc == nil || sc.UserID == "" {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth,
				"Authentication required", "Session required to set home dashboard", r.URL.Path, nil)
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.SetDashboardHomeForUser(r.Context(), tenant.ID, id, sc.UserID)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrDashboardNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Dashboard not found", "No dashboard with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "set home")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, dashboardToResponse(updated))
	}
}

// ─── Widget handlers ────────────────────────────────────────────────────────

type addWidgetRequest struct {
	Kind       string          `json:"kind"`
	Title      string          `json:"title"`
	DataSource string          `json:"dataSource,omitempty"`
	Config     json.RawMessage `json:"config,omitempty"`
	Layout     json.RawMessage `json:"layout,omitempty"`
}

type updateWidgetRequest struct {
	Kind           *string          `json:"kind,omitempty"`
	Title          *string          `json:"title,omitempty"`
	DataSource     *string          `json:"dataSource,omitempty"`
	Config         *json.RawMessage `json:"config,omitempty"`
	RawQuery       *string          `json:"rawQuery,omitempty"`
	LockedAdvanced *bool            `json:"lockedAdvanced,omitempty"`
	Layout         *json.RawMessage `json:"layout,omitempty"`
}

type updateLayoutRequest struct {
	Layouts map[string]json.RawMessage `json:"layouts"`
}

// ensureDashboardOwnership returns the dashboard if it's in the
// caller's tenant, else writes a 404 and returns nil.
func ensureDashboardOwnership(w http.ResponseWriter, r *http.Request, tx store.Tx, tenantID, dashboardID string) *store.Dashboard {
	d, err := tx.GetDashboard(r.Context(), tenantID, dashboardID)
	if err != nil {
		writeProblem(w, http.StatusNotFound, errTypeNotFound,
			"Dashboard not found", "No dashboard with id "+dashboardID, r.URL.Path, nil)
		return nil
	}
	return d
}

// ensureWidgetOwnership returns the widget if it belongs to a
// dashboard in the caller's tenant, else writes 404 and returns nil.
func ensureWidgetOwnership(w http.ResponseWriter, r *http.Request, tx store.Tx, tenantID, widgetID string) *store.Widget {
	widget, err := tx.GetWidget(r.Context(), widgetID)
	if err != nil {
		writeProblem(w, http.StatusNotFound, errTypeNotFound,
			"Widget not found", "No widget with id "+widgetID, r.URL.Path, nil)
		return nil
	}
	// Verify the parent dashboard is in this tenant.
	if _, err := tx.GetDashboard(r.Context(), tenantID, widget.DashboardID); err != nil {
		writeProblem(w, http.StatusNotFound, errTypeNotFound,
			"Widget not found", "No widget with id "+widgetID, r.URL.Path, nil)
		return nil
	}
	return widget
}

func handleListWidgets(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		dashboardID := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		if d := ensureDashboardOwnership(w, r, tx, tenant.ID, dashboardID); d == nil {
			return
		}
		widgets, err := tx.ListWidgetsByDashboard(r.Context(), dashboardID)
		if err != nil {
			writeInternalError(w, r, "list widgets")
			return
		}
		out := make([]widgetResponse, 0, len(widgets))
		for _, wg := range widgets {
			out = append(out, widgetToResponse(wg))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleAddWidget(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		dashboardID := r.PathValue("id")
		var req addWidgetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Kind == "" || req.Title == "" {
			writeBadRequest(w, r, "kind and title are required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if d := ensureDashboardOwnership(w, r, tx, tenant.ID, dashboardID); d == nil {
			_ = tx.Rollback()
			return
		}
		created, err := tx.CreateWidget(r.Context(), &store.Widget{
			DashboardID: dashboardID,
			Kind:        req.Kind,
			Title:       req.Title,
			DataSource:  req.DataSource,
			Config:      string(req.Config),
			Layout:      string(req.Layout),
		})
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "create widget")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, widgetToResponse(created))
	}
}

func handleUpdateWidget(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		var req updateWidgetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		params := store.UpdateWidgetParams{
			Kind:           req.Kind,
			Title:          req.Title,
			DataSource:     req.DataSource,
			RawQuery:       req.RawQuery,
			LockedAdvanced: req.LockedAdvanced,
		}
		if req.Config != nil {
			s := string(*req.Config)
			params.Config = &s
		}
		if req.Layout != nil {
			s := string(*req.Layout)
			params.Layout = &s
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if widget := ensureWidgetOwnership(w, r, tx, tenant.ID, id); widget == nil {
			_ = tx.Rollback()
			return
		}
		updated, err := tx.UpdateWidget(r.Context(), id, params)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "update widget")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, widgetToResponse(updated))
	}
}

func handleDeleteWidget(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		dashboardID := r.PathValue("id")
		widgetID := r.PathValue("wid")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if d := ensureDashboardOwnership(w, r, tx, tenant.ID, dashboardID); d == nil {
			_ = tx.Rollback()
			return
		}
		if err := tx.DeleteWidget(r.Context(), dashboardID, widgetID); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrWidgetNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound,
					"Widget not found", "No widget with id "+widgetID, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete widget")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleUpdateLayout(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		dashboardID := r.PathValue("id")
		var req updateLayoutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		layouts := make(map[string]string, len(req.Layouts))
		for k, v := range req.Layouts {
			layouts[k] = string(v)
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if d := ensureDashboardOwnership(w, r, tx, tenant.ID, dashboardID); d == nil {
			_ = tx.Rollback()
			return
		}
		if err := tx.UpdateDashboardLayout(r.Context(), dashboardID, layouts); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "update layout")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleFlipWidget(st store.Driver, locked bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if widget := ensureWidgetOwnership(w, r, tx, tenant.ID, id); widget == nil {
			_ = tx.Rollback()
			return
		}
		updated, err := tx.UpdateWidget(r.Context(), id, store.UpdateWidgetParams{LockedAdvanced: &locked})
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "flip widget")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, widgetToResponse(updated))
	}
}

// ─── Version / import / export handlers ─────────────────────────────────────

type snapshotRequest struct {
	Note string `json:"note,omitempty"`
}

type exportPayload struct {
	Dashboard dashboardResponse `json:"dashboard"`
	Widgets   []widgetResponse  `json:"widgets"`
}

func handleListVersions(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		dashboardID := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		if d := ensureDashboardOwnership(w, r, tx, tenant.ID, dashboardID); d == nil {
			return
		}
		versions, err := tx.ListDashboardVersions(r.Context(), dashboardID)
		if err != nil {
			writeInternalError(w, r, "list versions")
			return
		}
		out := make([]versionResponse, 0, len(versions))
		for _, v := range versions {
			out = append(out, versionToResponse(v))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

// snapshotDashboardLocked builds an export payload for the given
// dashboard and writes a new dashboard_versions row. Reused by both
// the explicit /snapshot endpoint and by /import.
func snapshotDashboardLocked(r *http.Request, tx store.Tx, d *store.Dashboard, note string) (*store.DashboardVersion, error) {
	widgets, err := tx.ListWidgetsByDashboard(r.Context(), d.ID)
	if err != nil {
		return nil, err
	}
	out := exportPayload{Dashboard: dashboardToResponse(d), Widgets: make([]widgetResponse, 0, len(widgets))}
	for _, wg := range widgets {
		out.Widgets = append(out.Widgets, widgetToResponse(wg))
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	var createdBy *string
	if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil && sc.UserID != "" {
		id := sc.UserID
		createdBy = &id
	}
	return tx.CreateDashboardVersion(r.Context(), &store.DashboardVersion{
		DashboardID:  d.ID,
		CreatedBy:    createdBy,
		Note:         note,
		SnapshotJSON: string(raw),
	})
}

func handleSnapshotDashboard(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		dashboardID := r.PathValue("id")
		var req snapshotRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		d := ensureDashboardOwnership(w, r, tx, tenant.ID, dashboardID)
		if d == nil {
			_ = tx.Rollback()
			return
		}
		v, err := snapshotDashboardLocked(r, tx, d, req.Note)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "snapshot")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, versionToResponse(v))
	}
}

func handleRestoreDashboardVersion(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		vid := r.PathValue("vid")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		v, err := tx.GetDashboardVersion(r.Context(), vid)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Version not found", "No version with id "+vid, r.URL.Path, nil)
			return
		}
		// Verify the version belongs to a dashboard in this tenant.
		dash := ensureDashboardOwnership(w, r, tx, tenant.ID, v.DashboardID)
		if dash == nil {
			_ = tx.Rollback()
			return
		}

		// Decode the snapshot back into a dashboard + widgets.
		var payload exportPayload
		if err := json.Unmarshal([]byte(v.SnapshotJSON), &payload); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "decode snapshot")
			return
		}

		// Apply: update dashboard fields, replace widgets.
		nameCopy := payload.Dashboard.Name
		descCopy := payload.Dashboard.Description
		modeCopy := payload.Dashboard.Mode
		scopeCopy := payload.Dashboard.Scope
		sharedJSON := string(payload.Dashboard.SharedRoleIDs)
		varsJSON := string(payload.Dashboard.Variables)
		if _, err := tx.UpdateDashboard(r.Context(), tenant.ID, dash.ID, store.UpdateDashboardParams{
			Name:          &nameCopy,
			Description:   &descCopy,
			Mode:          &modeCopy,
			Scope:         &scopeCopy,
			SharedRoleIDs: &sharedJSON,
			Variables:     &varsJSON,
		}); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "update dashboard")
			return
		}
		// Drop existing widgets and re-create from snapshot.
		existing, err := tx.ListWidgetsByDashboard(r.Context(), dash.ID)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "list existing widgets")
			return
		}
		for _, e := range existing {
			if err := tx.DeleteWidget(r.Context(), dash.ID, e.ID); err != nil {
				_ = tx.Rollback()
				writeInternalError(w, r, "delete existing widget")
				return
			}
		}
		for _, snap := range payload.Widgets {
			rawQuery := snap.RawQuery
			if _, err := tx.CreateWidget(r.Context(), &store.Widget{
				DashboardID:    dash.ID,
				Kind:           snap.Kind,
				Title:          snap.Title,
				DataSource:     snap.DataSource,
				Config:         string(snap.Config),
				RawQuery:       rawQuery,
				LockedAdvanced: snap.LockedAdvanced,
				Layout:         string(snap.Layout),
			}); err != nil {
				_ = tx.Rollback()
				writeInternalError(w, r, "create widget from snapshot")
				return
			}
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		// Return the restored dashboard.
		tx2, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx2.Rollback() }()
		restored, _ := tx2.GetDashboard(r.Context(), tenant.ID, dash.ID)
		writeJSON(w, http.StatusOK, dashboardToResponse(restored))
	}
}

func handleExportDashboard(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		dashboardID := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		d := ensureDashboardOwnership(w, r, tx, tenant.ID, dashboardID)
		if d == nil {
			return
		}
		widgets, err := tx.ListWidgetsByDashboard(r.Context(), dashboardID)
		if err != nil {
			writeInternalError(w, r, "list widgets")
			return
		}
		out := exportPayload{Dashboard: dashboardToResponse(d), Widgets: make([]widgetResponse, 0, len(widgets))}
		for _, wg := range widgets {
			out.Widgets = append(out.Widgets, widgetToResponse(wg))
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func handleImportDashboard(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		if tenant == nil {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		var payload exportPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if payload.Dashboard.Name == "" {
			writeBadRequest(w, r, "dashboard.name is required")
			return
		}
		var ownerID *string
		if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil && sc.UserID != "" {
			id := sc.UserID
			ownerID = &id
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		// Create a fresh dashboard (ignore the imported id to prevent
		// cross-tenant id collisions).
		created, err := tx.CreateDashboard(r.Context(), &store.Dashboard{
			TenantID:      tenant.ID,
			Name:          payload.Dashboard.Name,
			Description:   payload.Dashboard.Description,
			Mode:          payload.Dashboard.Mode,
			Scope:         payload.Dashboard.Scope,
			OwnerUserID:   ownerID,
			SharedRoleIDs: string(payload.Dashboard.SharedRoleIDs),
			Variables:     string(payload.Dashboard.Variables),
		})
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "create dashboard")
			return
		}
		for _, snap := range payload.Widgets {
			rawQuery := snap.RawQuery
			if _, err := tx.CreateWidget(r.Context(), &store.Widget{
				DashboardID:    created.ID,
				Kind:           snap.Kind,
				Title:          snap.Title,
				DataSource:     snap.DataSource,
				Config:         string(snap.Config),
				RawQuery:       rawQuery,
				LockedAdvanced: snap.LockedAdvanced,
				Layout:         string(snap.Layout),
			}); err != nil {
				_ = tx.Rollback()
				writeInternalError(w, r, "create widget")
				return
			}
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, dashboardToResponse(created))
	}
}
