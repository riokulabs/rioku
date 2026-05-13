// Package gateway — upstream health endpoint (#122).
//
//	GET /api/v1/upstreams/health
//
// Returns the most recent snapshot of upstream health collected by
// the Caddy admin API poller. Reads require `traffic:read` (matches
// other live-traffic endpoints).
//
// Backed by an UpstreamHealthSource implementation supplied by the
// daemon. When `src` is nil (e.g. Caddy isn't running, polling is
// disabled), the route returns an empty list with a `polled_at`
// of zero — the admin panel should render this as "data unavailable"
// rather than "no upstreams".
package gateway

import (
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/rerr"
)

// UpstreamHealthSource is the read interface the gateway needs from
// caddy.UpstreamHealthPoller. Defined here as a single-method
// interface so tests can supply a fake without spinning up a real
// poller + admin API.
type UpstreamHealthSource interface {
	Snapshot() *caddy.UpstreamHealthSnapshot
}

// upstreamHealthResponse is the JSON wire shape for the endpoint.
// Mirrors caddy.UpstreamHealthSnapshot but with explicit field tags
// so the contract is locked at this boundary.
type upstreamHealthResponse struct {
	PolledAt  time.Time              `json:"polledAt"`
	Upstreams []caddy.UpstreamHealth `json:"upstreams"`
	// Available is false when no source is wired (Caddy not running,
	// polling disabled). Lets the UI distinguish "no data yet" from
	// "no upstreams configured".
	Available bool `json:"available"`
}

// RegisterUpstreamHealthRoutes registers the upstream health endpoint.
// Always registers the route — when src is nil the handler returns
// an "unavailable" response instead of 404, so the admin panel can
// show a graceful empty state.
func RegisterUpstreamHealthRoutes(mux *http.ServeMux, src UpstreamHealthSource) {
	mux.Handle("GET /api/v1/upstreams/health",
		RequirePermission("traffic:read")(rerr.H(handleUpstreamHealth(src))))
}

func handleUpstreamHealth(src UpstreamHealthSource) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if src == nil {
			return rerr.JSON(w, upstreamHealthResponse{
				Upstreams: []caddy.UpstreamHealth{},
				Available: false,
			})
		}
		snap := src.Snapshot()
		ups := snap.Upstreams
		if ups == nil {
			ups = []caddy.UpstreamHealth{}
		}
		return rerr.JSON(w, upstreamHealthResponse{
			PolledAt:  snap.PolledAt,
			Upstreams: ups,
			Available: true,
		})
	}
}
