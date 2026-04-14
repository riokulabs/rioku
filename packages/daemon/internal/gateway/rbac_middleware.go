package gateway

import (
	"encoding/json"
	"net/http"

	"github.com/riokulabs/rioku/internal/auth"
)

// RequirePermission returns middleware that checks if the authenticated user
// has the specified permission via session-based RBAC scopes. Returns 403 if
// the permission is not present. Bearer tokens with an "admin" role are
// treated as having all permissions (bootstrap/API key path).
func RequirePermission(perm string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check session claims first (cookie auth).
			if sc := auth.SessionClaimsFromContext(r.Context()); sc != nil {
				if !sc.HasPermission(perm) {
					writeForbidden(w, r, perm)
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			// Check legacy claims (Bearer auth).
			if c := auth.ClaimsFromContext(r.Context()); c != nil {
				if bearerHasPermission(c.Roles, perm) {
					next.ServeHTTP(w, r)
					return
				}
				writeForbidden(w, r, perm)
				return
			}

			writeAuthError(w, r, "Authentication required")
		})
	}
}

// bearerHasPermission checks if a bearer token's roles/scopes cover the
// requested permission using the same wildcard logic as SessionClaims.
func bearerHasPermission(roles []string, perm string) bool {
	for _, r := range roles {
		if r == perm || r == "*" || r == "admin" {
			return true
		}
		if len(r) > 1 && r[len(r)-1] == '*' {
			prefix := r[:len(r)-1]
			if len(perm) >= len(prefix) && perm[:len(prefix)] == prefix {
				return true
			}
		}
	}
	return false
}

func writeForbidden(w http.ResponseWriter, r *http.Request, perm string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(ProblemDetail{
		Type:     errTypeForbidden,
		Title:    "Forbidden",
		Status:   403,
		Detail:   "Missing required permission: " + perm,
		Instance: r.URL.Path,
	})
}
