package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/gateway/links"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterKeyRoutes registers API key management endpoints. Both the
// legacy `/api/v1/keys` and the tenant-scoped `/api/v1/t/{tenant}/api-keys`
// paths are exposed; the legacy form falls through to the default tenant
// via `store.TenantIDFromContext`'s fallback, while the tenant-scoped
// form is resolved by `TenantMiddleware` and operates on whichever
// tenant the slug points to.
func RegisterKeyRoutes(mux *http.ServeMux, st store.Driver) {
	create := RequirePermission("keys:own")(http.HandlerFunc(handleKeyCreate(st)))
	list := RequirePermission("keys:own")(http.HandlerFunc(handleKeyList(st)))
	get := RequirePermission("keys:own")(http.HandlerFunc(handleKeyGet(st)))
	update := RequirePermission("keys:own")(http.HandlerFunc(handleKeyUpdate(st)))
	revoke := RequirePermission("keys:own")(http.HandlerFunc(handleKeyRevoke(st)))
	rotate := RequirePermission("keys:own")(http.HandlerFunc(handleKeyRotate(st)))
	usage := RequirePermission("keys:own")(http.HandlerFunc(handleKeyUsage(st)))

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
	Scopes    []string `json:"scopes"`
	OwnerID   string   `json:"ownerId,omitempty"`
	CreatedAt string   `json:"createdAt"`
}

func handleKeyCreate(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		var req keyCreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Invalid request",
				Status:   400,
				Detail:   "Request must be valid JSON with a 'name' field",
				Instance: r.URL.Path,
			})
			return
		}
		if req.Name == "" {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Validation failed",
				Status:   400,
				Detail:   "Key name is required",
				Instance: r.URL.Path,
				Errors:   []ValidationError{{Field: "name", Reason: "must not be empty"}},
			})
			return
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
			writeInternalError(w, r, "generate key")
			return
		}
		hash := auth.HashToken(rawKey)

		scopes := strings.Split(req.Scopes, ",")
		if req.Scopes == "" {
			scopes = []string{"keys:own"}
		}

		// Validate that requested scopes don't exceed creator's permissions.
		if !canSkipValidation {
			if err := auth.ValidateKeyScopes(scopes, creatorScopes); err != nil {
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(ProblemDetail{
					Type:     errTypeForbidden,
					Title:    "Scope escalation denied",
					Status:   403,
					Detail:   err.Error(),
					Instance: r.URL.Path,
				})
				return
			}
		}

		var expiresAt *time.Time
		if req.Expires != "" {
			d, err := time.ParseDuration(req.Expires)
			if err != nil {
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(ProblemDetail{
					Type:     errTypeValidation,
					Title:    "Validation failed",
					Status:   400,
					Detail:   fmt.Sprintf("Invalid expiration duration: %v", err),
					Instance: r.URL.Path,
					Errors:   []ValidationError{{Field: "expires", Reason: "must be a valid Go duration (e.g. 720h, 30d)", Value: req.Expires}},
				})
				return
			}
			t := time.Now().Add(d)
			expiresAt = &t
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}

		id, err := tx.CreateAPIKey(ctx, req.Name, hash, scopes, expiresAt, ownerID)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusInternalServerError, errTypeInternal,
				"create key failed", err.Error(), r.URL.Path, nil)
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":  id,
			"key": rawKey,
		})
	}
}

func handleKeyList(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		var keys []*store.APIKey
		if hasManage {
			keys, err = tx.ListAPIKeys(ctx)
		} else {
			keys, err = tx.ListAPIKeysByOwner(ctx, userID)
		}
		if err != nil {
			writeInternalError(w, r, "list keys")
			return
		}

		var result []keyResponse
		for _, k := range keys {
			if strings.HasPrefix(k.Name, "refresh:") || k.Name == "bootstrap" {
				continue // hide internal tokens
			}
			result = append(result, keyResponse{
				ID:        k.ID,
				Name:      k.Name,
				Scopes:    k.Scopes,
				OwnerID:   k.OwnerID,
				CreatedAt: k.CreatedAt.Format(time.RFC3339),
			})
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}
}

func handleKeyRevoke(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Tenant-scoped path uses `{id}` pattern variable; legacy path
		// embeds the id straight after `/api/v1/keys/`.
		id := r.PathValue("id")
		if id == "" {
			id = strings.TrimPrefix(r.URL.Path, "/api/v1/keys/")
		}
		if id == "" {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Validation failed",
				Status:   400,
				Detail:   "Key ID is required in the URL path",
				Instance: r.URL.Path,
			})
			return
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
			writeInternalError(w, r, "begin tx")
			return
		}

		// If the user doesn't have keys:manage, verify ownership first.
		if !hasManage {
			key, err := tx.GetAPIKey(ctx, id)
			if err != nil {
				_ = tx.Rollback()
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(ProblemDetail{
					Type:     errTypeNotFound,
					Title:    "Key not found",
					Status:   404,
					Detail:   fmt.Sprintf("API key %q not found or already revoked", id),
					Instance: r.URL.Path,
				})
				return
			}
			if key.OwnerID != userID {
				_ = tx.Rollback()
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(ProblemDetail{
					Type:     errTypeForbidden,
					Title:    "Forbidden",
					Status:   403,
					Detail:   "You can only revoke your own API keys",
					Instance: r.URL.Path,
				})
				return
			}
		}

		if err := tx.RevokeAPIKey(ctx, id); err != nil {
			_ = tx.Rollback()
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeNotFound,
				Title:    "Key not found",
				Status:   404,
				Detail:   fmt.Sprintf("API key %q not found or already revoked", id),
				Instance: r.URL.Path,
			})
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		w.WriteHeader(http.StatusNoContent)
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
func handleKeyUsage(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			writeBadRequest(w, r, "key id is required")
			return
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
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()

		key, err := tx.GetAPIKey(ctx, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Key not found",
				fmt.Sprintf("API key %q not found", id), r.URL.Path, nil)
			return
		}
		// Hide existence of keys the caller can't see (return 404 not 403).
		if !hasManage && key.OwnerID != userID {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Key not found",
				fmt.Sprintf("API key %q not found", id), r.URL.Path, nil)
			return
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

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func writeInternalError(w http.ResponseWriter, r *http.Request, context string) {
	requestID := r.Header.Get("X-Request-ID")
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusInternalServerError)
	_ = json.NewEncoder(w).Encode(ProblemDetail{
		Type:     errTypeInternal,
		Title:    "Internal server error",
		Status:   500,
		Detail:   "An unexpected error occurred. Reference: " + requestID,
		Instance: r.URL.Path,
	})
}

// writeBadRequest writes a 400 ProblemDetail with the supplied detail message.
// Used for invalid JSON bodies and validation failures on PATCH/POST endpoints.
func writeBadRequest(w http.ResponseWriter, r *http.Request, detail string) {
	writeProblem(w, http.StatusBadRequest, errTypeValidation, "Bad request", detail, r.URL.Path, nil)
}

// keyDetailDTO is the wire shape returned for an API key. Includes
// usage telemetry so the admin panel's keys page can render the row
// without a follow-up /usage call.
type keyDetailDTO struct {
	ID         string    `json:"id"`
	TenantID   string    `json:"tenantId"`
	Name       string    `json:"name"`
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
func handleKeyGet(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			writeBadRequest(w, r, "key id is required")
			return
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
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		key, err := tx.GetAPIKey(ctx, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Key not found",
				fmt.Sprintf("API key %q not found", id), r.URL.Path, nil)
			return
		}
		if !hasManage && key.OwnerID != userID {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Key not found",
				fmt.Sprintf("API key %q not found", id), r.URL.Path, nil)
			return
		}

		b := tenantBuilderOrRoot(tenant)
		writeJSON(w, http.StatusOK, keyToDetailDTO(key, b))
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
func handleKeyUpdate(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			writeBadRequest(w, r, "key id is required")
			return
		}

		var req keyUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
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
				writeBadRequest(w, r, "expiresAt must be RFC3339")
				return
			}
			tt := &t
			params.ExpiresAt = &tt
		}

		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		updated, err := tx.UpdateAPIKey(r.Context(), id, params)
		if err != nil {
			_ = tx.Rollback()
			if strings.Contains(err.Error(), "not found") {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Key not found",
					fmt.Sprintf("API key %q not found", id), r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update api key")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		b := tenantBuilderOrRoot(tenant)
		writeJSON(w, http.StatusOK, keyToDetailDTO(updated, b))
	}
}

// handleKeyRotate revokes the existing key and issues a new one with
// the same name + scopes + owner + expiry. The plaintext secret is
// returned ONCE on the response — the caller must capture it now.
func handleKeyRotate(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant := TenantFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			writeBadRequest(w, r, "key id is required")
			return
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
			writeInternalError(w, r, "begin tx")
			return
		}

		old, err := tx.GetAPIKey(ctx, id)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Key not found",
				fmt.Sprintf("API key %q not found", id), r.URL.Path, nil)
			return
		}
		if !hasManage && old.OwnerID != userID {
			_ = tx.Rollback()
			writeProblem(w, http.StatusForbidden, errTypeForbidden, "Forbidden",
				"You can only rotate your own API keys", r.URL.Path, nil)
			return
		}
		if old.RevokedAt != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusConflict, errTypeConflict, "Already revoked",
				"Cannot rotate an already-revoked key", r.URL.Path, nil)
			return
		}

		// Mint a new secret + hash, persist as a fresh key, revoke the old.
		raw, err := auth.GenerateBootstrapToken()
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "mint api key")
			return
		}
		hash := auth.HashToken(raw)
		newID, err := tx.CreateAPIKey(ctx, old.Name, hash, old.Scopes, old.ExpiresAt, old.OwnerID)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "create rotated key")
			return
		}
		if err := tx.RevokeAPIKey(ctx, id); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "revoke old key")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		b := tenantBuilderOrRoot(tenant)
		writeJSON(w, http.StatusOK, map[string]any{
			"id":  newID,
			"key": raw,
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
