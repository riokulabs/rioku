// Package riokuvars implements a Caddy handler module that sets
// request-scoped variables for route and service identification.
// These variables are consumed by Caddy's native log module to
// include Rioku context in structured access logs.
//
// Compiled into Caddy via xcaddy.
package riokuvars

import (
	"net/http"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

func init() {
	caddy.RegisterModule(Handler{})
}

// Handler sets rioku_route_id and rioku_service_id variables in
// the Caddy request context. These are picked up by the log module
// via extra_fields placeholders.
type Handler struct {
	RouteID   string `json:"route_id,omitempty"`
	ServiceID string `json:"service_id,omitempty"`
}

// CaddyModule returns the Caddy module information.
func (Handler) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_vars",
		New: func() caddy.Module { return new(Handler) },
	}
}

// ServeHTTP sets the route and service ID variables, then calls the next handler.
func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	caddyhttp.SetVar(r.Context(), "rioku_route_id", h.RouteID)
	caddyhttp.SetVar(r.Context(), "rioku_service_id", h.ServiceID)
	return next.ServeHTTP(w, r)
}

// Interface guard.
var _ caddyhttp.MiddlewareHandler = (*Handler)(nil)
