package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterKeyRoutes registers API key management endpoints.
func RegisterKeyRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("POST /api/v1/keys",
		RequirePermission("keys:own")(http.HandlerFunc(handleKeyCreate(st))))
	mux.Handle("GET /api/v1/keys",
		RequirePermission("keys:own")(http.HandlerFunc(handleKeyList(st))))
	mux.Handle("DELETE /api/v1/keys/",
		RequirePermission("keys:own")(http.HandlerFunc(handleKeyRevoke(st))))
	mux.Handle("GET /api/v1/keys/{id}/usage",
		RequirePermission("keys:own")(http.HandlerFunc(handleKeyUsage(st))))
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
			writeInternalError(w, r, "create key")
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
		// Extract ID from path: /api/v1/keys/<id>
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/keys/")
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
