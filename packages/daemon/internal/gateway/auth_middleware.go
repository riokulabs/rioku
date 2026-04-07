package gateway

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/riokulabs/rioku/internal/auth"
)

// skipAuthPaths are REST paths that don't require authentication.
var skipAuthPaths = map[string]bool{
	"/api/v1/health":       true,
	"/api/v1/health/caddy": true,
	"/api/v1/auth/token":   true,
	"/api/v1/auth/refresh": true,
}

// AuthMiddleware returns HTTP middleware that validates Bearer tokens.
func AuthMiddleware(a *auth.Auth) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth for non-API paths (admin panel static assets).
			if !strings.HasPrefix(r.URL.Path, "/api/") || skipAuthPaths[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}

			header := r.Header.Get("Authorization")
			if header == "" {
				writeAuthError(w, r, "Missing Authorization header")
				return
			}

			token := header
			if strings.HasPrefix(strings.ToLower(header), "bearer ") {
				token = header[7:]
			}

			claims, err := a.ValidateBearer(r.Context(), token)
			if err != nil {
				writeAuthError(w, r, "Invalid or expired token")
				return
			}

			// Inject claims into request context for downstream handlers.
			ctx := r.Context()
			ctx = auth.WithClaims(ctx, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeAuthError(w http.ResponseWriter, r *http.Request, detail string) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusUnauthorized)
	json.NewEncoder(w).Encode(ProblemDetail{
		Type:     errTypeUnauth,
		Title:    "Authentication required",
		Status:   401,
		Detail:   detail,
		Instance: r.URL.Path,
	})
}
