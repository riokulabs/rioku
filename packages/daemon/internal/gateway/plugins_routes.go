// Package gateway: Plugins + PluginSigners REST endpoints (stage-2).
//
// Tenant-scoped routes:
//
//	GET    /api/v1/t/{tenant}/plugins                         list installed
//	GET    /api/v1/t/{tenant}/plugins/{id}                    detail
//	POST   /api/v1/t/{tenant}/plugins/install                 install (no-op)
//	DELETE /api/v1/t/{tenant}/plugins/{id}                    uninstall
//	POST   /api/v1/t/{tenant}/plugins/{id}/enable             enable
//	POST   /api/v1/t/{tenant}/plugins/{id}/disable            disable
//	GET    /api/v1/t/{tenant}/plugins/{id}/build-log          build log tail
//	GET    /api/v1/t/{tenant}/plugin-marketplace              curated list
//	GET    /api/v1/t/{tenant}/plugin-marketplace/{id}         curated entry
//	POST   /api/v1/t/{tenant}/plugins/manifest/validate       manifest validator
//
//	/api/v1/t/{tenant}/plugin-signers       (CRUD + /verify + /revoke)
//
// Super-admin (global scope):
//
//	/api/v1/admin/plugin-signers
//	/api/v1/admin/plugins                   (global plugins)
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/plugins"
	"github.com/riokulabs/rioku/internal/store"
)

func RegisterPluginRoutes(mux *http.ServeMux, st store.Driver) {
	// Tenant-scoped plugins
	mux.Handle("GET /api/v1/t/{tenant}/plugins",
		RequirePermission("plugin:read")(http.HandlerFunc(handleListPlugins(st, false))))
	mux.Handle("POST /api/v1/t/{tenant}/plugins/install",
		RequirePermission("plugin:install")(http.HandlerFunc(handleInstallPlugin(st, false))))
	// Manifest validator — no install permission required, read is sufficient.
	mux.Handle("POST /api/v1/t/{tenant}/plugins/manifest/validate",
		RequirePermission("plugin:read")(http.HandlerFunc(handlePluginManifestValidate)))
	// Marketplace lives at a separate top-level path to avoid mux
	// pattern conflicts with /plugins/{id}.
	mux.Handle("GET /api/v1/t/{tenant}/plugin-marketplace",
		RequirePermission("plugin:read")(http.HandlerFunc(handlePluginMarketplaceList)))
	mux.Handle("GET /api/v1/t/{tenant}/plugin-marketplace/{id}",
		RequirePermission("plugin:read")(http.HandlerFunc(handlePluginMarketplaceGet)))
	mux.Handle("GET /api/v1/t/{tenant}/plugins/{id}",
		RequirePermission("plugin:read")(http.HandlerFunc(handleGetPlugin(st, false))))
	mux.Handle("DELETE /api/v1/t/{tenant}/plugins/{id}",
		RequirePermission("plugin:uninstall")(http.HandlerFunc(handleUninstallPlugin(st, false))))
	mux.Handle("POST /api/v1/t/{tenant}/plugins/{id}/enable",
		RequirePermission("plugin:enable")(http.HandlerFunc(handleTogglePlugin(st, false, true))))
	mux.Handle("POST /api/v1/t/{tenant}/plugins/{id}/disable",
		RequirePermission("plugin:enable")(http.HandlerFunc(handleTogglePlugin(st, false, false))))
	mux.Handle("GET /api/v1/t/{tenant}/plugins/{id}/build-log",
		RequirePermission("plugin:read")(http.HandlerFunc(handlePluginBuildLog(st, false))))

	// Tenant-scoped signers
	mux.Handle("GET /api/v1/t/{tenant}/plugin-signers",
		RequirePermission("plugin-signer:read")(http.HandlerFunc(handleListPluginSigners(st, false))))
	mux.Handle("POST /api/v1/t/{tenant}/plugin-signers",
		RequirePermission("plugin-signer:write")(http.HandlerFunc(handleCreatePluginSigner(st, false))))
	mux.Handle("GET /api/v1/t/{tenant}/plugin-signers/{id}",
		RequirePermission("plugin-signer:read")(http.HandlerFunc(handleGetPluginSigner(st, false))))
	mux.Handle("PUT /api/v1/t/{tenant}/plugin-signers/{id}",
		RequirePermission("plugin-signer:write")(http.HandlerFunc(handleUpdatePluginSigner(st, false))))
	mux.Handle("DELETE /api/v1/t/{tenant}/plugin-signers/{id}",
		RequirePermission("plugin-signer:delete")(http.HandlerFunc(handleDeletePluginSigner(st, false))))
	mux.Handle("POST /api/v1/t/{tenant}/plugin-signers/{id}/verify",
		RequirePermission("plugin-signer:write")(http.HandlerFunc(handleSetSignerStatus(st, false, "verified"))))
	mux.Handle("POST /api/v1/t/{tenant}/plugin-signers/{id}/revoke",
		RequirePermission("plugin-signer:write")(http.HandlerFunc(handleSetSignerStatus(st, false, "revoked"))))
	mux.Handle("GET /api/v1/t/{tenant}/plugin-signers/{id}/plugins",
		RequirePermission("plugin-signer:read")(http.HandlerFunc(handleListSignerPlugins(st, false))))

	// Global (super-admin) signers + plugins
	mux.Handle("GET /api/v1/admin/plugin-signers",
		RequirePermission("plugin-signer:read")(http.HandlerFunc(handleListPluginSigners(st, true))))
	mux.Handle("POST /api/v1/admin/plugin-signers",
		RequirePermission("plugin-signer:write")(http.HandlerFunc(handleCreatePluginSigner(st, true))))
	mux.Handle("GET /api/v1/admin/plugin-signers/{id}",
		RequirePermission("plugin-signer:read")(http.HandlerFunc(handleGetPluginSigner(st, true))))
	mux.Handle("PUT /api/v1/admin/plugin-signers/{id}",
		RequirePermission("plugin-signer:write")(http.HandlerFunc(handleUpdatePluginSigner(st, true))))
	mux.Handle("DELETE /api/v1/admin/plugin-signers/{id}",
		RequirePermission("plugin-signer:delete")(http.HandlerFunc(handleDeletePluginSigner(st, true))))
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

type pluginResponse struct {
	ID             string          `json:"id"`
	TenantScope    *string         `json:"tenantScope,omitempty"`
	Slug           string          `json:"slug"`
	Name           string          `json:"name"`
	Version        string          `json:"version"`
	Enabled        bool            `json:"enabled"`
	BuildState     string          `json:"buildState"`
	CosignVerified bool            `json:"cosignVerified"`
	SignerID       *string         `json:"signerId,omitempty"`
	Config         json.RawMessage `json:"config"`
	Metadata       json.RawMessage `json:"metadata"`
	InstalledAt    string          `json:"installedAt"`
	UpdatedAt      string          `json:"updatedAt"`
}

func pluginToResponse(p *store.Plugin) pluginResponse {
	return pluginResponse{
		ID: p.ID, TenantScope: p.TenantScope, Slug: p.Slug, Name: p.Name, Version: p.Version,
		Enabled: p.Enabled, BuildState: p.BuildState, CosignVerified: p.CosignVerified,
		SignerID:    p.SignerID,
		Config:      rawOrEmpty(p.Config, "{}"),
		Metadata:    rawOrEmpty(p.Metadata, "{}"),
		InstalledAt: p.InstalledAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:   p.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type signerResponse struct {
	ID          string  `json:"id"`
	TenantScope *string `json:"tenantScope,omitempty"`
	Name        string  `json:"name"`
	Fingerprint string  `json:"fingerprint"`
	Status      string  `json:"status"`
	Notes       string  `json:"notes"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

func signerToResponse(s *store.PluginSigner) signerResponse {
	return signerResponse{
		ID: s.ID, TenantScope: s.TenantScope, Name: s.Name, Fingerprint: s.Fingerprint,
		Status: s.Status, Notes: s.Notes,
		CreatedAt: s.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: s.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

// scopeForRequest returns the tenant id for the route. Empty string
// means global (super-admin) scope.
func scopeForRequest(r *http.Request, global bool) (string, bool) {
	if global {
		return "", true
	}
	tenant := TenantFromContext(r.Context())
	if tenant == nil {
		return "", false
	}
	return tenant.ID, true
}

// ─── Plugin handlers ────────────────────────────────────────────────────────

func handleListPlugins(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListPluginsByScope(r.Context(), scope)
		if err != nil {
			writeInternalError(w, r, "list plugins")
			return
		}
		out := make([]pluginResponse, 0, len(items))
		for _, p := range items {
			out = append(out, pluginToResponse(p))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleGetPlugin(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		p, err := tx.GetPlugin(r.Context(), scope, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Plugin not found",
				"No plugin with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, pluginToResponse(p))
	}
}

// handleInstallPlugin is a stage-2 stub: it inserts a placeholder
// `building` row that real install orchestration (#142/#143/#146) will
// later fill in. The admin panel calls this and then polls for build
// state transitions.
func handleInstallPlugin(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		var req struct {
			Slug    string `json:"slug"`
			Name    string `json:"name"`
			Version string `json:"version"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Slug == "" || req.Name == "" || req.Version == "" {
			writeBadRequest(w, r, "slug, name, version are required")
			return
		}
		var ts *string
		if scope != "" {
			ts = &scope
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreatePlugin(r.Context(), &store.Plugin{
			TenantScope: ts, Slug: req.Slug, Name: req.Name, Version: req.Version,
			Enabled: false, BuildState: "building",
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrPluginSlugTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Slug already in use",
					"A plugin with that slug already exists in this scope", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "install plugin")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusAccepted, pluginToResponse(created))
	}
}

func handleUninstallPlugin(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeletePlugin(r.Context(), scope, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrPluginNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Plugin not found",
					"No plugin with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "uninstall")
			return
		}
		// Drop any catalog rows this plugin registered. Per migration
		// 000049's source-handling rule, plugin-sourced rows are
		// deleted outright (they were never built-in). Idempotent —
		// returns 0 if the plugin never registered any.
		if _, err := tx.UnregisterPluginPermissions(r.Context(), id); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "unregister plugin permissions")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleTogglePlugin(st store.Driver, global, enabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdatePlugin(r.Context(), scope, id, store.UpdatePluginParams{Enabled: &enabled})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrPluginNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Plugin not found",
					"No plugin with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "toggle plugin")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, pluginToResponse(updated))
	}
}

func handlePluginBuildLog(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		p, err := tx.GetPlugin(r.Context(), scope, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Plugin not found",
				"No plugin with id "+id, r.URL.Path, nil)
			return
		}
		log := ""
		if p.LastBuildLog != nil {
			log = *p.LastBuildLog
		}
		writeJSON(w, http.StatusOK, map[string]any{"pluginId": p.ID, "buildState": p.BuildState, "log": log})
	}
}

// handlePluginMarketplaceList serves the curated first-party plugin catalog
// embedded at compile time from internal/plugins/marketplace.json.
func handlePluginMarketplaceList(w http.ResponseWriter, _ *http.Request) {
	items := plugins.MarketplaceItems()
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"total": len(items),
	})
}

// handlePluginMarketplaceGet returns a single curated marketplace entry by id.
func handlePluginMarketplaceGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	entry, ok := plugins.MarketplaceItem(id)
	if !ok {
		writeProblem(w, http.StatusNotFound, errTypeNotFound, "Marketplace entry not found",
			"No marketplace entry with id "+id, r.URL.Path, nil)
		return
	}
	writeJSON(w, http.StatusOK, entry)
}

// handlePluginManifestValidate accepts a plugin manifest JSON body, validates
// it against the required schema, and returns {valid, errors}.
func handlePluginManifestValidate(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeBadRequest(w, r, "invalid JSON body")
		return
	}
	valid, errs := plugins.ValidateManifest(raw)
	if errs == nil {
		errs = []plugins.ManifestValidationError{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"valid":  valid,
		"errors": errs,
	})
}

// ─── Signer handlers ────────────────────────────────────────────────────────

func handleListPluginSigners(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListPluginSignersByScope(r.Context(), scope)
		if err != nil {
			writeInternalError(w, r, "list signers")
			return
		}
		out := make([]signerResponse, 0, len(items))
		for _, s := range items {
			out = append(out, signerToResponse(s))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreatePluginSigner(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		var req struct {
			Name        string `json:"name"`
			Fingerprint string `json:"fingerprint"`
			Notes       string `json:"notes,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" || req.Fingerprint == "" {
			writeBadRequest(w, r, "name and fingerprint are required")
			return
		}
		var ts *string
		if scope != "" {
			ts = &scope
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreatePluginSigner(r.Context(), &store.PluginSigner{
			TenantScope: ts, Name: req.Name, Fingerprint: req.Fingerprint, Notes: req.Notes,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrPluginSignerFPTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Fingerprint already in use",
					"A signer with that fingerprint already exists in this scope", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create signer")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, signerToResponse(created))
	}
}

func handleGetPluginSigner(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		s, err := tx.GetPluginSigner(r.Context(), scope, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Signer not found",
				"No signer with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, signerToResponse(s))
	}
}

func handleUpdatePluginSigner(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		var req struct {
			Name        *string `json:"name,omitempty"`
			Fingerprint *string `json:"fingerprint,omitempty"`
			Notes       *string `json:"notes,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdatePluginSigner(r.Context(), scope, id, store.UpdatePluginSignerParams{
			Name: req.Name, Fingerprint: req.Fingerprint, Notes: req.Notes,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrPluginSignerNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Signer not found",
					"No signer with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update signer")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, signerToResponse(updated))
	}
}

func handleDeletePluginSigner(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeletePluginSigner(r.Context(), scope, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrPluginSignerNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Signer not found",
					"No signer with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete signer")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleSetSignerStatus(st store.Driver, global bool, status string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdatePluginSigner(r.Context(), scope, id, store.UpdatePluginSignerParams{Status: &status})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrPluginSignerNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Signer not found",
					"No signer with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "set signer status")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, signerToResponse(updated))
	}
}

func handleListSignerPlugins(st store.Driver, global bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, ok := scopeForRequest(r, global)
		if !ok {
			writeInternalError(w, r, "tenant resolution")
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		// Verify ownership.
		if _, err := tx.GetPluginSigner(r.Context(), scope, id); err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Signer not found",
				"No signer with id "+id, r.URL.Path, nil)
			return
		}
		items, err := tx.ListPluginsBySigner(r.Context(), id)
		if err != nil {
			writeInternalError(w, r, "list plugins by signer")
			return
		}
		out := make([]pluginResponse, 0, len(items))
		for _, p := range items {
			out = append(out, pluginToResponse(p))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}
