// Package gateway: SSO providers REST endpoints (#240).
//
// Routes:
//
//	GET    /api/v1/t/{tenant}/sso/providers       list configured providers
//	POST   /api/v1/t/{tenant}/sso/providers       create
//	GET    /api/v1/t/{tenant}/sso/providers/{id}  fetch one
//	PATCH  /api/v1/t/{tenant}/sso/providers/{id}  partial update
//	DELETE /api/v1/t/{tenant}/sso/providers/{id}  remove
//
// All mutations emit a typed `auth.sso_provider_changed.v1` audit row.
// RBAC: sso:read (list/get) and sso:write (create/update/delete).
//
// This is the admin surface only — the runtime data-plane OIDC plugin
// (#170) consumes these rows; it does not register here.
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
	storeaudit "github.com/riokulabs/rioku/internal/store/audit"
)

// RegisterSsoRoutes wires the per-tenant SSO provider CRUD endpoints.
func RegisterSsoRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("GET /api/v1/t/{tenant}/sso/providers",
		RequirePermission("sso:read")(http.HandlerFunc(handleListSsoProviders(st))))
	mux.Handle("POST /api/v1/t/{tenant}/sso/providers",
		RequirePermission("sso:write")(http.HandlerFunc(handleCreateSsoProvider(st))))
	mux.Handle("GET /api/v1/t/{tenant}/sso/providers/{id}",
		RequirePermission("sso:read")(http.HandlerFunc(handleGetSsoProvider(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/sso/providers/{id}",
		RequirePermission("sso:write")(http.HandlerFunc(handleUpdateSsoProvider(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/sso/providers/{id}",
		RequirePermission("sso:write")(http.HandlerFunc(handleDeleteSsoProvider(st))))
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

type ssoProviderResponse struct {
	ID                  string          `json:"id"`
	TenantID            string          `json:"tenantId"`
	Name                string          `json:"name"`
	Kind                string          `json:"kind"`
	OIDCIssuer          *string         `json:"oidcIssuer,omitempty"`
	OIDCClientID        *string         `json:"oidcClientId,omitempty"`
	OIDCClientSecretRef *string         `json:"oidcClientSecretRef,omitempty"`
	OIDCScopes          json.RawMessage `json:"oidcScopes"`
	ClaimsMapping       json.RawMessage `json:"claimsMapping"`
	Enabled             bool            `json:"enabled"`
	CreatedAt           string          `json:"createdAt"`
	UpdatedAt           string          `json:"updatedAt"`
}

func ssoProviderToResponse(p *store.SsoProvider) ssoProviderResponse {
	return ssoProviderResponse{
		ID:                  p.ID,
		TenantID:            p.TenantID,
		Name:                p.Name,
		Kind:                p.Kind,
		OIDCIssuer:          p.OIDCIssuer,
		OIDCClientID:        p.OIDCClientID,
		OIDCClientSecretRef: p.OIDCClientSecretRef,
		OIDCScopes:          rawOrEmpty(p.OIDCScopes, "[]"),
		ClaimsMapping:       rawOrEmpty(p.ClaimsMapping, "{}"),
		Enabled:             p.Enabled,
		CreatedAt:           p.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:           p.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type createSsoProviderRequest struct {
	Name                string          `json:"name"`
	Kind                string          `json:"kind"`
	OIDCIssuer          *string         `json:"oidcIssuer,omitempty"`
	OIDCClientID        *string         `json:"oidcClientId,omitempty"`
	OIDCClientSecretRef *string         `json:"oidcClientSecretRef,omitempty"`
	OIDCScopes          json.RawMessage `json:"oidcScopes,omitempty"`
	ClaimsMapping       json.RawMessage `json:"claimsMapping,omitempty"`
	Enabled             *bool           `json:"enabled,omitempty"`
}

type updateSsoProviderRequest struct {
	Name                *string          `json:"name,omitempty"`
	Kind                *string          `json:"kind,omitempty"`
	OIDCIssuer          *string          `json:"oidcIssuer,omitempty"`
	OIDCClientID        *string          `json:"oidcClientId,omitempty"`
	OIDCClientSecretRef *string          `json:"oidcClientSecretRef,omitempty"`
	OIDCScopes          *json.RawMessage `json:"oidcScopes,omitempty"`
	ClaimsMapping       *json.RawMessage `json:"claimsMapping,omitempty"`
	Enabled             *bool            `json:"enabled,omitempty"`
}

// ─── Validation helpers ─────────────────────────────────────────────────────

func validateKind(kind string) bool {
	return kind == "oidc" || kind == "saml"
}

// ─── Handlers ───────────────────────────────────────────────────────────────

func handleListSsoProviders(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListSsoProvidersByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list sso providers")
			return
		}
		out := make([]ssoProviderResponse, 0, len(items))
		for _, p := range items {
			out = append(out, ssoProviderToResponse(p))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleGetSsoProvider(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		p, err := tx.GetSsoProvider(r.Context(), tenant.ID, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
				"No SSO provider with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, ssoProviderToResponse(p))
	}
}

func handleCreateSsoProvider(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req createSsoProviderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" || req.Kind == "" {
			writeBadRequest(w, r, "name and kind are required")
			return
		}
		if !validateKind(req.Kind) {
			writeBadRequest(w, r, "kind must be one of: oidc, saml")
			return
		}
		// OIDC requires issuer + client_id at create time so the runtime
		// plugin (#170) can dial the discovery endpoint without admin
		// re-edit. Secret ref is allowed empty so an operator can wire
		// it later via PATCH (#169 secrets land out-of-band).
		if req.Kind == "oidc" {
			if req.OIDCIssuer == nil || *req.OIDCIssuer == "" {
				writeBadRequest(w, r, "oidcIssuer is required for kind=oidc")
				return
			}
			if req.OIDCClientID == nil || *req.OIDCClientID == "" {
				writeBadRequest(w, r, "oidcClientId is required for kind=oidc")
				return
			}
		}
		enabled := true
		if req.Enabled != nil {
			enabled = *req.Enabled
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateSsoProvider(r.Context(), &store.SsoProvider{
			TenantID:            tenant.ID,
			Name:                req.Name,
			Kind:                req.Kind,
			OIDCIssuer:          req.OIDCIssuer,
			OIDCClientID:        req.OIDCClientID,
			OIDCClientSecretRef: req.OIDCClientSecretRef,
			OIDCScopes:          string(req.OIDCScopes),
			ClaimsMapping:       string(req.ClaimsMapping),
			Enabled:             enabled,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrSsoProviderTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"An SSO provider with that name already exists in this tenant",
					r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create sso provider")
			return
		}
		if err := emitSsoAudit(r.Context(), tx, r, "create", created, tenant.ID); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "audit")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, ssoProviderToResponse(created))
	}
}

func handleUpdateSsoProvider(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		var req updateSsoProviderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Kind != nil && !validateKind(*req.Kind) {
			writeBadRequest(w, r, "kind must be one of: oidc, saml")
			return
		}
		params := store.UpdateSsoProviderParams{
			Name: req.Name, Kind: req.Kind, Enabled: req.Enabled,
			OIDCIssuer:          req.OIDCIssuer,
			OIDCClientID:        req.OIDCClientID,
			OIDCClientSecretRef: req.OIDCClientSecretRef,
		}
		if req.OIDCScopes != nil {
			s := string(*req.OIDCScopes)
			params.OIDCScopes = &s
		}
		if req.ClaimsMapping != nil {
			s := string(*req.ClaimsMapping)
			params.ClaimsMapping = &s
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateSsoProvider(r.Context(), tenant.ID, id, params)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrSsoProviderNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
					"No SSO provider with id "+id, r.URL.Path, nil)
				return
			}
			if errors.Is(err, store.ErrSsoProviderTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"An SSO provider with that name already exists in this tenant",
					r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update sso provider")
			return
		}
		if err := emitSsoAudit(r.Context(), tx, r, "update", updated, tenant.ID); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "audit")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, ssoProviderToResponse(updated))
	}
}

func handleDeleteSsoProvider(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		// Resolve the row before delete so the audit row carries name/kind
		// even after the underlying record is gone.
		existing, err := tx.GetSsoProvider(r.Context(), tenant.ID, id)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
				"No SSO provider with id "+id, r.URL.Path, nil)
			return
		}
		if err := tx.DeleteSsoProvider(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrSsoProviderNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
					"No SSO provider with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete sso provider")
			return
		}
		if err := emitSsoAudit(r.Context(), tx, r, "delete", existing, tenant.ID); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "audit")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// emitSsoAudit appends a typed auth.sso_provider_changed.v1 row under
// the active tx. Pulls the actor id off the session claims so the audit
// row has a real identity even when the request is via API key.
func emitSsoAudit(ctx context.Context, tx store.Tx, r *http.Request, op string, p *store.SsoProvider, tenantID string) error {
	actor := ""
	if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil {
		actor = sc.UserID
	}
	entry, err := storeaudit.BuildEntry(
		storeaudit.DefaultRegistry,
		actor,
		"sso_provider",
		p.ID,
		op,
		&storeaudit.SsoProviderChanged{
			Operation:    op,
			ProviderID:   p.ID,
			ProviderName: p.Name,
			Kind:         p.Kind,
			TenantID:     tenantID,
		},
	)
	if err != nil {
		return err
	}
	return tx.AppendAuditEntry(ctx, entry)
}
