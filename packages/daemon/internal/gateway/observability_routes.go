// Package gateway — observability endpoints (#191).
//
//	GET /api/v1/observability/jwks
//
// Returns the in-process JWKS refresh registry: per-source URL
// status, last-refresh time, last-error, and consecutive-failure
// counter. Reads require `settings:read` because the data leaks
// the configured JWKS upstreams (operators-only territory).
//
// Source: observability.JWKSRegistry, populated by the rioku_jwt
// data-plane plugin via the keyvalidator /jwks-refresh ingress.
package gateway

import (
	"net/http"

	"github.com/riokulabs/rioku/internal/observability"
)

type jwksObservabilityResponse struct {
	Available bool                      `json:"available"`
	Entries   []observability.JWKSEntry `json:"entries"`
}

// RegisterObservabilityRoutes registers the observability surface.
// When reg is nil (rioku_jwt not configured / data plane not yet
// reporting), the handler returns Available=false with an empty
// entries slice so the admin panel can render a graceful empty
// state rather than a 404.
func RegisterObservabilityRoutes(mux *http.ServeMux, reg *observability.JWKSRegistry) {
	mux.Handle("GET /api/v1/observability/jwks",
		RequirePermission("settings:read")(http.HandlerFunc(handleJWKSObservability(reg))))
}

func handleJWKSObservability(reg *observability.JWKSRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if reg == nil {
			writeJSON(w, http.StatusOK, jwksObservabilityResponse{
				Available: false,
				Entries:   []observability.JWKSEntry{},
			})
			return
		}
		snap := reg.Snapshot()
		if snap == nil {
			snap = []observability.JWKSEntry{}
		}
		writeJSON(w, http.StatusOK, jwksObservabilityResponse{
			Available: true,
			Entries:   snap,
		})
	}
}
