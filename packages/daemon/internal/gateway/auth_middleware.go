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
	"/api/v1/auth/login":   true,
}

// AuthMiddleware returns HTTP middleware that validates sessions (cookie-first)
// with Bearer token fallback. If sm is nil, only Bearer auth is attempted.
func AuthMiddleware(a *auth.Auth, sm *auth.SessionManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth for non-API paths (admin panel static assets),
			// skip-listed paths, and CORS preflight (OPTIONS) requests.
			if !strings.HasPrefix(r.URL.Path, "/api/") || skipAuthPaths[r.URL.Path] || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}

			// Priority 1: rioku_sid cookie (web UI / session-based auth).
			if sm != nil {
				if cookie, err := r.Cookie(auth.SessionCookieName); err == nil {
					claims, err := sm.ValidateSession(r.Context(), cookie.Value, r)
					if err != nil {
						sm.ClearCookie(w, auth.CookieOptions{})
						writeAuthError(w, r, "Session invalid or expired")
						return
					}
					legacyClaims := sessionClaimsToLegacy(claims)
					ctx := auth.WithClaims(r.Context(), legacyClaims)
					ctx = auth.WithSessionClaims(ctx, claims)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}

			// Priority 2: Authorization: Bearer <token> (CLI, API keys).
			header := r.Header.Get("Authorization")
			if header == "" {
				writeAuthError(w, r, "Missing Authorization header or session cookie")
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

			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// sessionClaimsToLegacy converts SessionClaims to the legacy Claims type
// so downstream handlers that read auth.ClaimsFromContext continue to work.
func sessionClaimsToLegacy(sc *auth.SessionClaims) *auth.Claims {
	return &auth.Claims{
		Subject:   sc.UserID,
		Roles:     sc.Roles,
		TokenType: auth.TokenTypeAccess,
	}
}

func writeAuthError(w http.ResponseWriter, r *http.Request, detail string) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(ProblemDetail{
		Type:     errTypeUnauth,
		Title:    "Authentication required",
		Status:   401,
		Detail:   detail,
		Instance: r.URL.Path,
	})
}
