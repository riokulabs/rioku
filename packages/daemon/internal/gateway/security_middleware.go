package gateway

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/riokulabs/rioku/internal/config"
)

// SecurityHeadersMiddleware adds security headers to all responses.
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

		// CSP for API responses (admin panel CSP is handled by the SPA HTML).
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		}

		next.ServeHTTP(w, r)
	})
}

// CORSMiddleware handles CORS preflight and response headers.
func CORSMiddleware(cfg config.CORSConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}

			allowed := false
			for _, o := range cfg.AllowedOrigins {
				if o == "*" || o == origin {
					allowed = true
					break
				}
			}
			if !allowed {
				next.ServeHTTP(w, r)
				return
			}

			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")

			if r.Method == http.MethodOptions {
				// CORS preflight: set the Access-Control-* headers and
				// fall through so the resource's OPTIONS handler can add
				// `Allow`, `Accept-Patch`, and `X-Rioku-Capabilities`.
				// When no resource OPTIONS handler is registered, mux's
				// 405 (with its own Allow header) reaches the browser —
				// which is the correct preflight outcome for unsupported
				// methods, and 404 for unknown paths.
				w.Header().Set("Access-Control-Allow-Methods", strings.Join(cfg.AllowedMethods, ", "))
				w.Header().Set("Access-Control-Allow-Headers", strings.Join(cfg.AllowedHeaders, ", "))
				w.Header().Set("Access-Control-Max-Age", fmt.Sprintf("%d", cfg.MaxAge))
			}

			next.ServeHTTP(w, r)
		})
	}
}

// BodyLimitMiddleware limits request body size for non-streaming endpoints.
func BodyLimitMiddleware(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip body limiting for SSE and streaming endpoints.
			if strings.HasPrefix(r.URL.Path, "/api/v1/events") {
				next.ServeHTTP(w, r)
				return
			}

			if r.Body != nil && r.ContentLength > maxBytes {
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(http.StatusRequestEntityTooLarge)
				_, _ = fmt.Fprintf(w, `{"type":"%s","title":"Request too large","status":413,"detail":"Request body exceeds maximum allowed size","instance":"%s"}`,
					errTypeValidation, r.URL.Path)
				return
			}

			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}
