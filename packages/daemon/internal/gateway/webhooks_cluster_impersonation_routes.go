// Package gateway: Webhooks + Cluster enrollment + Impersonation REST.
//
// Routes:
//
//	/api/v1/t/{tenant}/settings/webhooks      WebhookEndpoint CRUD
//	/api/v1/t/{tenant}/cluster/enrollment-tokens   tenant view of cluster tokens
//	/api/v1/admin/cluster/enrollment-tokens   super-admin issuing
//	/api/v1/admin/impersonation               super-admin start/end
package gateway

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

func RegisterWebhooksClusterImpersonationRoutes(mux *http.ServeMux, st store.Driver) {
	// Webhooks
	mux.Handle("GET /api/v1/t/{tenant}/settings/webhooks",
		RequirePermission("integrations:read")(rerr.H(handleListWebhooks(st))))
	mux.Handle("POST /api/v1/t/{tenant}/settings/webhooks",
		RequirePermission("integrations:write")(rerr.H(handleCreateWebhook(st))))
	mux.Handle("GET /api/v1/t/{tenant}/settings/webhooks/{id}",
		RequirePermission("integrations:read")(rerr.H(handleGetWebhook(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/settings/webhooks/{id}",
		RequirePermission("integrations:write")(rerr.H(handleUpdateWebhook(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/settings/webhooks/{id}",
		RequirePermission("integrations:write")(rerr.H(handleDeleteWebhook(st))))

	// Cluster enrollment tokens — read available to tenant cluster admins,
	// generate/revoke is super-admin (admin/cluster:enroll). The tenant
	// /cluster/enrollment-tokens path mirrors the spec.
	mux.Handle("GET /api/v1/t/{tenant}/cluster/enrollment-tokens",
		RequirePermission("cluster:read")(rerr.H(handleListEnrollmentTokens(st))))
	mux.Handle("POST /api/v1/t/{tenant}/cluster/enrollment-tokens",
		RequirePermission("cluster:enroll")(rerr.H(handleCreateEnrollmentToken(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/cluster/enrollment-tokens/{id}",
		RequirePermission("cluster:enroll")(rerr.H(handleRevokeEnrollmentToken(st))))

	// Impersonation (super-admin only)
	mux.Handle("POST /api/v1/admin/impersonation",
		RequirePermission("user:impersonate")(rerr.H(handleStartImpersonation(st))))
	mux.Handle("DELETE /api/v1/admin/impersonation/{id}",
		RequirePermission("user:impersonate")(rerr.H(handleEndImpersonation(st))))
	mux.Handle("GET /api/v1/admin/impersonation",
		RequirePermission("admin:cross-tenant-read")(rerr.H(handleListImpersonationSessions(st))))
	mux.Handle("POST /api/v1/admin/impersonation/{id}/touch",
		RequirePermission("user:impersonate")(rerr.H(handleTouchImpersonation(st))))
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

type webhookResponse struct {
	ID        string          `json:"id"`
	TenantID  string          `json:"tenantId"`
	Name      string          `json:"name"`
	URL       string          `json:"url"`
	Events    json.RawMessage `json:"events"`
	Enabled   bool            `json:"enabled"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	// Secret intentionally omitted from list/detail.
}

func webhookToResponse(e *store.WebhookEndpoint) webhookResponse {
	return webhookResponse{
		ID: e.ID, TenantID: e.TenantID, Name: e.Name, URL: e.URL,
		Events:    rawOrEmpty(e.Events, "[]"),
		Enabled:   e.Enabled,
		CreatedAt: e.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: e.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleListWebhooks(st store.Driver) rerr.Handler {
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
		items, err := tx.ListWebhookEndpointsByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list webhooks")
		}
		out := make([]webhookResponse, 0, len(items))
		for _, e := range items {
			out = append(out, webhookToResponse(e))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateWebhook(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Name   string          `json:"name"`
			URL    string          `json:"url"`
			Secret *string         `json:"secret,omitempty"`
			Events json.RawMessage `json:"events,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Name == "" || req.URL == "" {
			return rerr.Validation(map[string]string{"name": "name and url are required"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		created, err := tx.CreateWebhookEndpoint(r.Context(), &store.WebhookEndpoint{
			TenantID: tenant.ID, Name: req.Name, URL: req.URL, Secret: req.Secret,
			Events: string(req.Events), Enabled: true,
		})
		if err != nil {
			if errors.Is(err, store.ErrWebhookEndpointNameTaken) {
				return rerr.Conflict("A webhook with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create webhook")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, webhookToResponse(created))
	}
}

func handleGetWebhook(st store.Driver) rerr.Handler {
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
		e, err := tx.GetWebhookEndpoint(r.Context(), tenant.ID, id)
		if err != nil {
			return rerr.NotFound("webhook", id)
		}
		return rerr.JSON(w, webhookToResponse(e))
	}
}

func handleUpdateWebhook(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			Name    *string          `json:"name,omitempty"`
			URL     *string          `json:"url,omitempty"`
			Secret  *string          `json:"secret,omitempty"`
			Events  *json.RawMessage `json:"events,omitempty"`
			Enabled *bool            `json:"enabled,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		params := store.UpdateWebhookEndpointParams{
			Name: req.Name, URL: req.URL, Secret: req.Secret, Enabled: req.Enabled,
		}
		if req.Events != nil {
			s := string(*req.Events)
			params.Events = &s
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		updated, err := tx.UpdateWebhookEndpoint(r.Context(), tenant.ID, id, params)
		if err != nil {
			if errors.Is(err, store.ErrWebhookEndpointNotFound) {
				return rerr.NotFound("webhook", id)
			}
			return rerr.Wrap(err, "update webhook")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, webhookToResponse(updated))
	}
}

func handleDeleteWebhook(st store.Driver) rerr.Handler {
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
		if err := tx.DeleteWebhookEndpoint(r.Context(), tenant.ID, id); err != nil {
			if errors.Is(err, store.ErrWebhookEndpointNotFound) {
				return rerr.NotFound("webhook", id)
			}
			return rerr.Wrap(err, "delete webhook")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ─── Cluster Enrollment Tokens ──────────────────────────────────────────────

type enrollmentTokenResponse struct {
	ID               string  `json:"id"`
	CreatedBy        *string `json:"createdBy,omitempty"`
	ExpiresAt        string  `json:"expiresAt"`
	ConsumedAt       *string `json:"consumedAt,omitempty"`
	ConsumedByNodeID *string `json:"consumedByNodeId,omitempty"`
	RevokedAt        *string `json:"revokedAt,omitempty"`
	Notes            string  `json:"notes"`
	CreatedAt        string  `json:"createdAt"`
}

type createEnrollmentTokenResponse struct {
	enrollmentTokenResponse
	// Token is the raw token string returned ONCE on creation. Never persisted.
	Token string `json:"token"`
}

func enrollmentTokenToResponse(t *store.ClusterEnrollmentToken) enrollmentTokenResponse {
	out := enrollmentTokenResponse{
		ID: t.ID, CreatedBy: t.CreatedBy,
		ExpiresAt:        t.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		ConsumedByNodeID: t.ConsumedByNodeID, Notes: t.Notes,
		CreatedAt: t.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if t.ConsumedAt != nil {
		s := t.ConsumedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.ConsumedAt = &s
	}
	if t.RevokedAt != nil {
		s := t.RevokedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.RevokedAt = &s
	}
	return out
}

func handleListEnrollmentTokens(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		// No tenant filter — cluster is global. The route is tenant-scoped
		// only because the admin UI lives under /t/{tenant}/cluster.
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListActiveEnrollmentTokens(r.Context())
		if err != nil {
			return rerr.Wrap(err, "list enrollment tokens")
		}
		out := make([]enrollmentTokenResponse, 0, len(items))
		for _, tok := range items {
			out = append(out, enrollmentTokenToResponse(tok))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateEnrollmentToken(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var req struct {
			TTLSeconds int    `json:"ttlSeconds,omitempty"`
			Notes      string `json:"notes,omitempty"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		ttl := 24 * time.Hour
		if req.TTLSeconds > 0 {
			ttl = time.Duration(req.TTLSeconds) * time.Second
		}

		// Generate a 32-byte token, hash with SHA-256 for storage.
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			return rerr.Wrap(err, "generate token")
		}
		token := hex.EncodeToString(raw)
		hash := sha256.Sum256(raw)
		hashHex := hex.EncodeToString(hash[:])

		var createdBy *string
		if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil && sc.UserID != "" {
			id := sc.UserID
			createdBy = &id
		}

		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		created, err := tx.CreateEnrollmentToken(r.Context(), &store.ClusterEnrollmentToken{
			TokenHash: hashHex, CreatedBy: createdBy,
			ExpiresAt: time.Now().UTC().Add(ttl), Notes: req.Notes,
		})
		if err != nil {
			return rerr.Wrap(err, "create enrollment token")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, createEnrollmentTokenResponse{
			enrollmentTokenResponse: enrollmentTokenToResponse(created),
			Token:                   token,
		})
	}
}

func handleRevokeEnrollmentToken(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		if err := tx.RevokeEnrollmentToken(r.Context(), id); err != nil {
			switch {
			case errors.Is(err, store.ErrEnrollmentTokenNotFound):
				return rerr.NotFound("enrollment token", id)
			case errors.Is(err, store.ErrEnrollmentTokenAlreadyUsed):
				return rerr.Conflict("Token already consumed or revoked", err)
			default:
				return rerr.Wrap(err, "revoke token")
			}
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ─── Impersonation Sessions ─────────────────────────────────────────────────

type impersonationResponse struct {
	ID           string  `json:"id"`
	SuperAdminID string  `json:"superAdminId"`
	TenantID     *string `json:"tenantId,omitempty"`
	UserID       *string `json:"userId,omitempty"`
	Reason       string  `json:"reason"`
	StartedAt    string  `json:"startedAt"`
	ExpiresAt    string  `json:"expiresAt"`
	LastActiveAt *string `json:"lastActiveAt,omitempty"`
	EndedAt      *string `json:"endedAt,omitempty"`
	EndReason    *string `json:"endReason,omitempty"`
}

func impersonationToResponse(s *store.ImpersonationSession) impersonationResponse {
	out := impersonationResponse{
		ID: s.ID, SuperAdminID: s.SuperAdminID, TenantID: s.TenantID, UserID: s.UserID,
		Reason: s.Reason, EndReason: s.EndReason,
		StartedAt: s.StartedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		ExpiresAt: s.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if s.LastActiveAt != nil {
		st := s.LastActiveAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.LastActiveAt = &st
	}
	if s.EndedAt != nil {
		st := s.EndedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.EndedAt = &st
	}
	return out
}

func handleStartImpersonation(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var req struct {
			TenantID   *string `json:"tenantId,omitempty"`
			UserID     *string `json:"userId,omitempty"`
			Reason     string  `json:"reason"`
			TTLSeconds int     `json:"ttlSeconds,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Reason == "" {
			return rerr.Validation(map[string]string{"reason": "reason is required"})
		}
		ttl := time.Hour // default 1h
		if req.TTLSeconds > 0 {
			ttl = time.Duration(req.TTLSeconds) * time.Second
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		if sc == nil || sc.UserID == "" {
			return rerr.Unauthenticated()
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		// The client sends a tenant slug (the URL-safe identifier used in routes).
		// impersonation_sessions.tenant_id has a FK to tenants(id) which stores
		// internal UUIDs, not slugs. Resolve slug → id so the INSERT doesn't
		// violate the FK constraint. Fall back to id-based lookup so API callers
		// that already have the internal id still work.
		var tenantID *string
		if req.TenantID != nil && *req.TenantID != "" {
			t, slugErr := tx.GetTenantBySlug(r.Context(), *req.TenantID)
			if slugErr != nil {
				t, slugErr = tx.GetTenant(r.Context(), *req.TenantID)
				if slugErr != nil {
					return rerr.NotFound("tenant", *req.TenantID)
				}
			}
			tenantID = &t.ID
		}

		created, err := tx.CreateImpersonationSession(r.Context(), &store.ImpersonationSession{
			SuperAdminID: sc.UserID, TenantID: tenantID, UserID: req.UserID,
			Reason: req.Reason, ExpiresAt: time.Now().UTC().Add(ttl),
		})
		if err != nil {
			return rerr.Wrap(err, "start impersonation")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, impersonationToResponse(created))
	}
}

func handleEndImpersonation(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		updated, err := tx.EndImpersonationSession(r.Context(), id, "explicit_exit")
		if err != nil {
			switch {
			case errors.Is(err, store.ErrImpersonationSessionNotFound):
				return rerr.NotFound("impersonation session", id)
			case errors.Is(err, store.ErrImpersonationSessionEnded):
				return rerr.Conflict("That impersonation session is already closed", err)
			default:
				return rerr.Wrap(err, "end impersonation")
			}
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, impersonationToResponse(updated))
	}
}

func handleListImpersonationSessions(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListActiveImpersonationSessions(r.Context())
		if err != nil {
			return rerr.Wrap(err, "list impersonation sessions")
		}
		out := make([]impersonationResponse, 0, len(items))
		for _, s := range items {
			out = append(out, impersonationToResponse(s))
		}
		// OpenAPI: ListImpersonationSessions200 = `{sessions: [...]}`.
		// Emitting `{items}` made the SPA's `useImpersonationSession`
		// read `data.data.sessions → undefined → []`, which kept the
		// banner permanently hidden even with a live session.
		return rerr.JSON(w, map[string]any{
			"sessions": out,
		})
	}
}

func handleTouchImpersonation(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		if err := tx.TouchImpersonationSession(r.Context(), id); err != nil {
			if errors.Is(err, store.ErrImpersonationSessionNotFound) {
				return rerr.NotFound("impersonation session", id)
			}
			return rerr.Wrap(err, "touch impersonation")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}
