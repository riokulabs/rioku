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
				// Bearer tokens from bootstrap/API keys have "admin" role.
				for _, role := range c.Roles {
					if role == "admin" {
						next.ServeHTTP(w, r)
						return
					}
				}
				writeForbidden(w, r, perm)
				return
			}

			writeAuthError(w, r, "Authentication required")
		})
	}
}

func writeForbidden(w http.ResponseWriter, r *http.Request, perm string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(ProblemDetail{
		Type:     errTypeForbidden,
		Title:    "Forbidden",
		Status:   403,
		Detail:   "Missing required permission: " + perm,
		Instance: r.URL.Path,
	})
}
