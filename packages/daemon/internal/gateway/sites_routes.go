// Package gateway: Sites REST endpoints.
//
//	GET    /api/v1/t/{tenant}/sites              list                 site:read
//	POST   /api/v1/t/{tenant}/sites              create               site:write
//	GET    /api/v1/t/{tenant}/sites/{id}         detail               site:read
//	PUT    /api/v1/t/{tenant}/sites/{id}         update               site:write
//	DELETE /api/v1/t/{tenant}/sites/{id}         delete               site:delete
//	PATCH  /api/v1/t/{tenant}/sites/{id}/enabled toggle enabled flag  site:write
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

func RegisterSiteRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("GET /api/v1/t/{tenant}/sites",
		RequirePermission("site:read")(rerr.H(handleListSites(st))))
	mux.Handle("POST /api/v1/t/{tenant}/sites",
		RequirePermission("site:write")(rerr.H(handleCreateSite(st))))
	mux.Handle("GET /api/v1/t/{tenant}/sites/{id}",
		RequirePermission("site:read")(rerr.H(handleGetSite(st))))
	// PUT and PATCH share the same underlying handler — both accept the
	// pointer-field updateSiteRequest where omitted fields are unchanged.
	// Future work can split them when the storage layer grows a discrete
	// "replace whole row" path; for now the verbs are equivalent.
	mux.Handle("PUT /api/v1/t/{tenant}/sites/{id}",
		RequirePermission("site:write")(rerr.H(handleUpdateSite(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/sites/{id}",
		RequirePermission("site:write")(rerr.H(handleUpdateSite(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/sites/{id}",
		RequirePermission("site:delete")(rerr.H(handleDeleteSite(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/sites/{id}/enabled",
		RequirePermission("site:write")(rerr.H(handleToggleSite(st))))
	mux.Handle("POST /api/v1/t/{tenant}/sites/{id}/toggle",
		RequirePermission("site:write")(rerr.H(handleToggleSite(st))))

	optionsutil.Register(mux, "/api/v1/t/{tenant}/sites",
		[]string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/sites/{id}",
		[]string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/sites/{id}/enabled",
		[]string{"PATCH"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/sites/{id}/toggle",
		[]string{"POST"})
}

type siteResponse struct {
	ID                string  `json:"id"`
	TenantID          string  `json:"tenantId"`
	Name              string  `json:"name"`
	Domain            string  `json:"domain"`
	TLSMode           string  `json:"tlsMode"`
	Enabled           bool    `json:"enabled"`
	UpstreamServiceID *string `json:"upstreamServiceId,omitempty"`
	BasicAuthEnabled  bool    `json:"basicAuthEnabled"`
	BasicAuthRealm    *string `json:"basicAuthRealm,omitempty"`
	RateLimitPreset   string  `json:"rateLimitPreset"`
	RedirectRules     string  `json:"redirectRules"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

func siteToResponse(s *store.Site) siteResponse {
	return siteResponse{
		ID:                s.ID,
		TenantID:          s.TenantID,
		Name:              s.Name,
		Domain:            s.Domain,
		TLSMode:           s.TLSMode,
		Enabled:           s.Enabled,
		UpstreamServiceID: s.UpstreamServiceID,
		BasicAuthEnabled:  s.BasicAuthEnabled,
		BasicAuthRealm:    s.BasicAuthRealm,
		RateLimitPreset:   s.RateLimitPreset,
		RedirectRules:     s.RedirectRules,
		CreatedAt:         s.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:         s.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type createSiteRequest struct {
	Name              string  `json:"name"`
	Domain            string  `json:"domain"`
	TLSMode           string  `json:"tlsMode,omitempty"`
	UpstreamServiceID *string `json:"upstreamServiceId,omitempty"`
	BasicAuthEnabled  bool    `json:"basicAuthEnabled,omitempty"`
	BasicAuthRealm    *string `json:"basicAuthRealm,omitempty"`
	RateLimitPreset   string  `json:"rateLimitPreset,omitempty"`
	RedirectRules     string  `json:"redirectRules,omitempty"`
}

type updateSiteRequest struct {
	Name              *string `json:"name,omitempty"`
	Domain            *string `json:"domain,omitempty"`
	TLSMode           *string `json:"tlsMode,omitempty"`
	UpstreamServiceID *string `json:"upstreamServiceId,omitempty"`
	BasicAuthEnabled  *bool   `json:"basicAuthEnabled,omitempty"`
	BasicAuthRealm    *string `json:"basicAuthRealm,omitempty"`
	RateLimitPreset   *string `json:"rateLimitPreset,omitempty"`
	RedirectRules     *string `json:"redirectRules,omitempty"`
}

type toggleSiteRequest struct {
	Enabled bool `json:"enabled"`
}

func handleListSites(st store.Driver) rerr.Handler {
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
		sites, err := tx.ListSitesByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list sites")
		}
		out := make([]siteResponse, 0, len(sites))
		for _, s := range sites {
			out = append(out, siteToResponse(s))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateSite(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req createSiteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Name == "" || req.Domain == "" {
			return rerr.Validation(map[string]string{"body": "name and domain are required"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		created, err := tx.CreateSite(r.Context(), &store.Site{
			TenantID:          tenant.ID,
			Name:              req.Name,
			Domain:            req.Domain,
			TLSMode:           req.TLSMode,
			Enabled:           true,
			UpstreamServiceID: req.UpstreamServiceID,
			BasicAuthEnabled:  req.BasicAuthEnabled,
			BasicAuthRealm:    req.BasicAuthRealm,
			RateLimitPreset:   req.RateLimitPreset,
			RedirectRules:     req.RedirectRules,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrSiteDomainTaken) {
				return rerr.Conflict("a site with that domain already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create site")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		_ = triggerCaddyReload(r.Context(), "site.create")
		return rerr.JSONStatus(w, http.StatusCreated, siteToResponse(created))
	}
}

func handleGetSite(st store.Driver) rerr.Handler {
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
		site, err := tx.GetSite(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrSiteNotFound) {
				return rerr.NotFound("site", id)
			}
			return rerr.Wrap(err, "get site")
		}
		return rerr.JSON(w, siteToResponse(site))
	}
}

func handleUpdateSite(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req updateSiteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		updated, err := tx.UpdateSite(r.Context(), tenant.ID, id, store.UpdateSiteParams{
			Name:              req.Name,
			Domain:            req.Domain,
			TLSMode:           req.TLSMode,
			UpstreamServiceID: req.UpstreamServiceID,
			BasicAuthEnabled:  req.BasicAuthEnabled,
			BasicAuthRealm:    req.BasicAuthRealm,
			RateLimitPreset:   req.RateLimitPreset,
			RedirectRules:     req.RedirectRules,
		})
		if err != nil {
			_ = tx.Rollback()
			switch {
			case errors.Is(err, store.ErrSiteNotFound):
				return rerr.NotFound("site", id)
			case errors.Is(err, store.ErrSiteDomainTaken):
				return rerr.Conflict("another site already uses that domain", err)
			default:
				return rerr.Wrap(err, "update site")
			}
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		_ = triggerCaddyReload(r.Context(), "site.update")
		return rerr.JSON(w, siteToResponse(updated))
	}
}

func handleToggleSite(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req toggleSiteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		updated, err := tx.ToggleSite(r.Context(), tenant.ID, id, req.Enabled)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrSiteNotFound) {
				return rerr.NotFound("site", id)
			}
			return rerr.Wrap(err, "toggle site")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		_ = triggerCaddyReload(r.Context(), "site.toggle")
		return rerr.JSON(w, siteToResponse(updated))
	}
}

func handleDeleteSite(st store.Driver) rerr.Handler {
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
		if err := tx.DeleteSite(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrSiteNotFound) {
				return rerr.NotFound("site", id)
			}
			return rerr.Wrap(err, "delete site")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		_ = triggerCaddyReload(r.Context(), "site.delete")
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}
