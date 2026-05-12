package gateway

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/gateway/links"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterKeyRoutes registers API key management endpoints. Both the
// legacy `/api/v1/keys` and the tenant-scoped `/api/v1/t/{tenant}/api-keys`
// paths are exposed; the legacy form falls through to the default tenant
// via `store.TenantIDFromContext`'s fallback, while the tenant-scoped
// form is resolved by `TenantMiddleware` and operates on whichever
// tenant the slug points to.
func RegisterKeyRoutes(mux *http.ServeMux, st store.Driver) {
	create := RequirePermission("keys:own")(rerr.H(handleKeyCreate(st)))
	list := RequirePermission("keys:own")(rerr.H(handleKeyList(st)))
	get := RequirePermission("keys:own")(rerr.H(handleKeyGet(st)))
	update := RequirePermission("keys:own")(rerr.H(handleKeyUpdate(st)))
	revoke := RequirePermission("keys:own")(rerr.H(handleKeyRevoke(st)))
	rotate := RequirePermission("keys:own")(rerr.H(handleKeyRotate(st)))
	usage := RequirePermission("keys:own")(rerr.H(handleKeyUsage(st)))

	mux.Handle("POST /api/v1/keys", create)
	mux.Handle("GET /api/v1/keys", list)
	mux.Handle("DELETE /api/v1/keys/", revoke)
	mux.Handle("GET /api/v1/keys/{id}/usage", usage)

	mux.Handle("POST /api/v1/t/{tenant}/api-keys", create)
	mux.Handle("GET /api/v1/t/{tenant}/api-keys", list)
	mux.Handle("GET /api/v1/t/{tenant}/api-keys/{id}", get)
	mux.Handle("PUT /api/v1/t/{tenant}/api-keys/{id}", update)
	mux.Handle("PATCH /api/v1/t/{tenant}/api-keys/{id}", update)
	mux.Handle("DELETE /api/v1/t/{tenant}/api-keys/{id}", revoke)
	mux.Handle("POST /api/v1/t/{tenant}/api-keys/{id}/revoke", revoke)
	mux.Handle("POST /api/v1/t/{tenant}/api-keys/{id}/rotate", rotate)
	mux.Handle("GET /api/v1/t/{tenant}/api-keys/{id}/usage", usage)

	optionsutil.Register(mux, "/api/v1/keys",
		[]string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/keys/{id}",
		[]string{"DELETE"})
	optionsutil.Register(mux, "/api/v1/keys/{id}/usage",
		[]string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/api-keys",
		[]string{"GET", "POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/api-keys/{id}",
		[]string{"GET", "PUT", "PATCH", "DELETE"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/api-keys/{id}/revoke",
		[]string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/api-keys/{id}/rotate",
		[]string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/api-keys/{id}/usage",
		[]string{"GET"})
}

type keyCreateRequest struct {
	Name    string `json:"name"`
	Scopes  string `json:"scopes"`
	Expires string `json:"expires"`
}

type keyResponse struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Prefix    string   `json:"prefix,omitempty"`
	Scopes    []string `json:"scopes"`
	OwnerID   string   `json:"ownerId,omitempty"`
	CreatedAt string   `json:"createdAt"`
}

func handleKeyCreate(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		var req keyCreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "Request must be valid JSON with a 'name' field"})
		}
		if req.Name == "" {
			return rerr.Validation(map[string]string{"name": "must not be empty"})
		}

		// Determine creator identity and scopes.
		ctx := r.Context()
		var ownerID string
		var creatorScopes []string
		var canSkipValidation bool

		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			ownerID = sc.UserID
			creatorScopes = sc.Scopes
			canSkipValidation = sc.HasPermission("keys:manage") ||
				sc.HasPermission("admin") || sc.HasPermission("*")
		} else if c := auth.ClaimsFromContext(ctx); c != nil {
			// Bearer/API key auth — subject is "apikey:<id>", owner is system.
			ownerID = ""
			creatorScopes = c.Roles
			for _, role := range c.Roles {
				if role == "admin" || role == "keys:manage" || role == "*" {
					canSkipValidation = true
					break
				}
			}
		}

		rawKey, err := auth.GenerateBootstrapToken() // generates rku_tok_ prefixed key
		if err != nil {
			return rerr.Wrap(err, "generate key")
		}
		hash := auth.HashToken(rawKey)
		prefix := auth.KeyPrefix(rawKey)

		scopes := strings.Split(req.Scopes, ",")
		if req.Scopes == "" {
			scopes = []string{"keys:own"}
		}

		// Validate that requested scopes don't exceed creator's permissions.
		if !canSkipValidation {
			if err := auth.ValidateKeyScopes(scopes, creatorScopes); err != nil {
				return rerr.Forbidden(err.Error())
			}
		}

		var expiresAt *time.Time
		if req.Expires != "" {
			d, err := time.ParseDuration(req.Expires)
			if err != nil {
				return rerr.Validation(map[string]string{"expires": "must be a valid Go duration (e.g. 720h, 30d)"})
			}
			t := time.Now().Add(d)
			expiresAt = &t
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		id, err := tx.CreateAPIKey(ctx, req.Name, hash, prefix, scopes, expiresAt, ownerID)
		if err != nil {
			return rerr.Wrap(err, "create api key")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		w.WriteHeader(http.StatusCreated)
		return rerr.JSON(w, map[string]any{
			"id":     id,
			"key":    rawKey,
			"prefix": prefix,
		})
	}
}

func handleKeyList(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()

		// Determine user identity and whether they can see all keys.
		var userID string
		var hasManage bool

		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			userID = sc.UserID
			hasManage = sc.HasPermission("keys:manage") ||
				sc.HasPermission("admin") || sc.HasPermission("*")
		} else if c := auth.ClaimsFromContext(ctx); c != nil {
			// Bearer auth — if it passed RequirePermission, it has admin role.
			for _, role := range c.Roles {
				if role == "admin" || role == "keys:manage" || role == "*" {
					hasManage = true
					break
				}
			}
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		var keys []*store.APIKey
		if hasManage {
			keys, err = tx.ListAPIKeys(ctx)
		} else {
			keys, err = tx.ListAPIKeysByOwner(ctx, userID)
		}
		if err != nil {
			return rerr.Wrap(err, "list keys")
		}

		result := []keyResponse{}
		for _, k := range keys {
			if strings.HasPrefix(k.Name, "refresh:") || k.Name == "bootstrap" {
				continue // hide internal tokens
			}
			result = append(result, keyResponse{
				ID:        k.ID,
				Name:      k.Name,
				Prefix:    k.Prefix,
				Scopes:    k.Scopes,
				OwnerID:   k.OwnerID,
				CreatedAt: k.CreatedAt.Format(time.RFC3339),
			})
		}

		// OpenAPI: ListApiKeys200 = `{apiKeys: [...], nextPageToken: ""}`.
		// Emitting a bare array made `useAPIKeyList` (which reads
		// `data.data.apiKeys`) resolve to `undefined → []`, so the
		// Security › API keys page was empty even when keys existed.
		// Pagination is unimplemented — emit an empty token.
		return rerr.JSON(w, map[string]any{
			"apiKeys":       result,
			"nextPageToken": "",
		})
	}
}

func handleKeyRevoke(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		// Tenant-scoped path uses `{id}` pattern variable; legacy path
		// embeds the id straight after `/api/v1/keys/`.
		id := r.PathValue("id")
		if id == "" {
			id = strings.TrimPrefix(r.URL.Path, "/api/v1/keys/")
		}
		if id == "" {
			return rerr.Validation(map[string]string{"id": "Key ID is required in the URL path"})
		}

		ctx := r.Context()

		// Determine user identity and whether they can revoke any key.
		var userID string
		var hasManage bool

		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			userID = sc.UserID
			hasManage = sc.HasPermission("keys:manage") ||
				sc.HasPermission("admin") || sc.HasPermission("*")
		} else if c := auth.ClaimsFromContext(ctx); c != nil {
			for _, role := range c.Roles {
				if role == "admin" || role == "keys:manage" || role == "*" {
					hasManage = true
					break
				}
			}
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		// If the user doesn't have keys:manage, verify ownership first.
		if !hasManage {
			key, err := tx.GetAPIKey(ctx, id)
			if err != nil {
				return rerr.NotFound("api key", id)
			}
			if key.OwnerID != userID {
				return rerr.Forbidden("You can only revoke your own API keys")
			}
		}

		if err := tx.RevokeAPIKey(ctx, id); err != nil {
			return rerr.NotFound("api key", id)
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// handleKeyUsage returns simple usage stats for one API key (#85).
//
//	GET /api/v1/keys/{id}/usage
//
// Response: { "id", "name", "lastUsedAt", "usageCount", "createdAt" }
//
// Permission rules mirror the other key routes: keys:own users see
// only their own keys; keys:manage / admin / * users see any key.
// Returns 404 (not 403) for keys that exist but the caller can't
// view, to avoid leaking key-id existence to unprivileged callers.
func handleKeyUsage(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "key id is required"})
		}

		ctx := r.Context()
		var userID string
		var hasManage bool
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			userID = sc.UserID
			hasManage = sc.HasPermission("keys:manage") ||
				sc.HasPermission("admin") || sc.HasPermission("*")
		} else if c := auth.ClaimsFromContext(ctx); c != nil {
			for _, role := range c.Roles {
				if role == "admin" || role == "keys:manage" || role == "*" {
					hasManage = true
					break
				}
			}
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		key, err := tx.GetAPIKey(ctx, id)
		if err != nil {
			return rerr.NotFound("api key", id)
		}
		// Hide existence of keys the caller can't see (return 404 not 403).
		if !hasManage && key.OwnerID != userID {
			return rerr.NotFound("api key", id)
		}

		resp := map[string]any{
			"id":         key.ID,
			"name":       key.Name,
			"createdAt":  key.CreatedAt.Format(time.RFC3339),
			"usageCount": key.UsageCount,
		}
		if key.LastUsedAt != nil {
			resp["lastUsedAt"] = key.LastUsedAt.Format(time.RFC3339)
		}
		if key.RevokedAt != nil {
			resp["revokedAt"] = key.RevokedAt.Format(time.RFC3339)
		}
		if key.ExpiresAt != nil {
			resp["expiresAt"] = key.ExpiresAt.Format(time.RFC3339)
		}

		return rerr.JSON(w, resp)
	}
}

// keyDetailDTO is the wire shape returned for an API key. Includes
// usage telemetry so the admin panel's keys page can render the row
// without a follow-up /usage call.
type keyDetailDTO struct {
	ID         string    `json:"id"`
	TenantID   string    `json:"tenantId"`
	Name       string    `json:"name"`
	Prefix     string    `json:"prefix,omitempty"`
	Scopes     []string  `json:"scopes"`
	OwnerID    string    `json:"ownerId,omitempty"`
	ExpiresAt  *string   `json:"expiresAt,omitempty"`
	CreatedAt  string    `json:"createdAt"`
	RevokedAt  *string   `json:"revokedAt,omitempty"`
	LastUsedAt *string   `json:"lastUsedAt,omitempty"`
	UsageCount int64     `json:"usageCount"`
	Links      links.Set `json:"_links"`
}

func keyToDetailDTO(k *store.APIKey, b *links.Builder) keyDetailDTO {
	dto := keyDetailDTO{
		ID:         k.ID,
		TenantID:   k.TenantID,
		Name:       k.Name,
		Prefix:     k.Prefix,
		Scopes:     k.Scopes,
		OwnerID:    k.OwnerID,
		CreatedAt:  k.CreatedAt.UTC().Format(time.RFC3339),
		UsageCount: k.UsageCount,
		Links: links.Set{
			"self":   b.Self("api-keys", k.ID),
			"revoke": b.Action("api-keys", k.ID, "revoke"),
			"rotate": b.Action("api-keys", k.ID, "rotate"),
			"usage":  b.Action("api-keys", k.ID, "usage"),
		},
	}
	if k.OwnerID != "" {
		dto.Links["owner"] = b.Self("users", k.OwnerID)
	}
	if k.ExpiresAt != nil {
		s := k.ExpiresAt.UTC().Format(time.RFC3339)
		dto.ExpiresAt = &s
	}
	if k.RevokedAt != nil {
		s := k.RevokedAt.UTC().Format(time.RFC3339)
		dto.RevokedAt = &s
	}
	if k.LastUsedAt != nil {
		s := k.LastUsedAt.UTC().Format(time.RFC3339)
		dto.LastUsedAt = &s
	}
	return dto
}

// handleKeyGet returns one API key by id.
func handleKeyGet(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant := TenantFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "key id is required"})
		}

		ctx := r.Context()
		var userID string
		var hasManage bool
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			userID = sc.UserID
			hasManage = sc.HasPermission("keys:manage") ||
				sc.HasPermission("admin") || sc.HasPermission("*")
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		key, err := tx.GetAPIKey(ctx, id)
		if err != nil {
			return rerr.NotFound("api key", id)
		}
		if !hasManage && key.OwnerID != userID {
			return rerr.NotFound("api key", id)
		}

		b := tenantBuilderOrRoot(tenant)
		return rerr.JSON(w, keyToDetailDTO(key, b))
	}
}

// keyUpdateRequest is the shape accepted by PUT and PATCH on
// /api/v1/t/{tenant}/api-keys/{id}. All fields are optional pointers;
// PATCH and PUT share semantics — a missing field is unchanged. To
// clear an existing expiry, pass `"expiresAt": null` (the JSON null
// triggers UpdateAPIKeyParams.ExpiresAt = pointer-to-nil).
type keyUpdateRequest struct {
	Name      *string   `json:"name,omitempty"`
	Scopes    *[]string `json:"scopes,omitempty"`
	ExpiresAt *string   `json:"expiresAt,omitempty"`
	// ClearExpiresAt is the explicit "clear expiry" flag for callers
	// that don't want to send a JSON null. Either mechanism works.
	ClearExpiresAt bool `json:"clearExpiresAt,omitempty"`
}

// handleKeyUpdate handles PUT and PATCH; semantics are identical for
// API keys (no required-field replace path).
func handleKeyUpdate(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant := TenantFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "key id is required"})
		}

		var req keyUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		params := store.UpdateAPIKeyParams{
			Name:   req.Name,
			Scopes: req.Scopes,
		}
		if req.ClearExpiresAt {
			var nilPtr *time.Time
			params.ExpiresAt = &nilPtr
		} else if req.ExpiresAt != nil {
			t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
			if err != nil {
				return rerr.Validation(map[string]string{"expiresAt": "must be RFC3339"})
			}
			tt := &t
			params.ExpiresAt = &tt
		}

		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		updated, err := tx.UpdateAPIKey(r.Context(), id, params)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				return rerr.NotFound("api key", id)
			}
			return rerr.Wrap(err, "update api key")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		b := tenantBuilderOrRoot(tenant)
		return rerr.JSON(w, keyToDetailDTO(updated, b))
	}
}

// handleKeyRotate revokes the existing key and issues a new one with
// the same name + scopes + owner + expiry. The plaintext secret is
// returned ONCE on the response — the caller must capture it now.
func handleKeyRotate(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant := TenantFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "key id is required"})
		}

		ctx := r.Context()
		var userID string
		var hasManage bool
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil {
			userID = sc.UserID
			hasManage = sc.HasPermission("keys:manage") ||
				sc.HasPermission("admin") || sc.HasPermission("*")
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		old, err := tx.GetAPIKey(ctx, id)
		if err != nil {
			return rerr.NotFound("api key", id)
		}
		if !hasManage && old.OwnerID != userID {
			return rerr.Forbidden("You can only rotate your own API keys")
		}
		if old.RevokedAt != nil {
			return rerr.Conflict("Cannot rotate an already-revoked key", nil)
		}

		// Mint a new secret + hash, persist as a fresh key, revoke the old.
		raw, err := auth.GenerateBootstrapToken()
		if err != nil {
			return rerr.Wrap(err, "mint api key")
		}
		hash := auth.HashToken(raw)
		newPrefix := auth.KeyPrefix(raw)
		newID, err := tx.CreateAPIKey(ctx, old.Name, hash, newPrefix, old.Scopes, old.ExpiresAt, old.OwnerID)
		if err != nil {
			return rerr.Wrap(err, "create rotated key")
		}
		if err := tx.RevokeAPIKey(ctx, id); err != nil {
			return rerr.Wrap(err, "revoke old key")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		b := tenantBuilderOrRoot(tenant)
		return rerr.JSON(w, map[string]any{
			"id":     newID,
			"key":    raw,
			"prefix": newPrefix,
			"_links": links.Set{
				"self":  b.Self("api-keys", newID),
				"prior": b.Self("api-keys", id),
			},
		})
	}
}

// tenantBuilderOrRoot returns a tenant-scoped builder when a tenant is
// attached to the context, otherwise a root builder. The legacy
// `/api/v1/keys` paths run without a resolved tenant.
func tenantBuilderOrRoot(tenant *store.Tenant) *links.Builder {
	if tenant != nil {
		return links.NewTenantBuilder(tenant.Slug)
	}
	return links.NewRootBuilder()
}
