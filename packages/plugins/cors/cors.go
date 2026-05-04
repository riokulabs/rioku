// Package cors implements the first-party Rioku CORS Caddy module.
//
// The handler enforces Cross-Origin Resource Sharing semantics for the
// inbound request: it matches the Origin header against the
// configured allow-list, sets the appropriate Access-Control-* headers
// on the response, and short-circuits OPTIONS preflight requests with
// a 204 status before they reach upstream services.
//
// When the request's origin is not in the allow-list the handler
// emits no CORS headers and forwards the request unchanged — the
// browser is responsible for blocking the response on the client
// side. This keeps non-browser clients (curl, server-to-server) from
// being denied by a misconfigured allow-list.
package cors

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(CORS{})
	httpcaddyfile.RegisterHandlerDirective("rioku_cors", parseCaddyfileHandler)
}

// CORS is a Caddy handler that applies CORS policy to inbound
// requests. Match semantics follow the Fetch spec: an exact, case-
// sensitive comparison between the request's Origin header and the
// configured AllowedOrigins list. The wildcard "*" matches any
// origin but cannot be combined with AllowCredentials per the spec.
type CORS struct {
	// AllowedOrigins is the list of origins permitted to access
	// resources behind this handler. The wildcard "*" allows any
	// origin. Required — Provision rejects an empty list.
	AllowedOrigins []string `json:"allowed_origins,omitempty"`

	// AllowedMethods is the list of methods returned in
	// Access-Control-Allow-Methods on preflight responses. Empty
	// defaults to GET, HEAD, POST, OPTIONS (the CORS-safelisted
	// set plus OPTIONS so preflight itself is reachable).
	AllowedMethods []string `json:"allowed_methods,omitempty"`

	// AllowedHeaders is the list of request headers permitted in
	// Access-Control-Allow-Headers on preflight responses. Empty
	// reflects whatever the request asked for via
	// Access-Control-Request-Headers — convenient for development,
	// not recommended for hardened deployments.
	AllowedHeaders []string `json:"allowed_headers,omitempty"`

	// ExposeHeaders is the list of response headers safe to expose
	// to JavaScript via Access-Control-Expose-Headers. Empty omits
	// the header entirely (only the CORS-safelisted response
	// headers are reachable in that case).
	ExposeHeaders []string `json:"expose_headers,omitempty"`

	// MaxAgeSeconds is the value of Access-Control-Max-Age on
	// preflight responses. Browsers cache preflight results for at
	// most this many seconds. Zero defaults to 600 (10 minutes).
	MaxAgeSeconds int `json:"max_age_seconds,omitempty"`

	// AllowCredentials sets Access-Control-Allow-Credentials: true
	// when the origin matches. The Fetch spec forbids combining
	// this with the wildcard origin — Provision rejects that
	// combination at config time.
	AllowCredentials bool `json:"allow_credentials,omitempty"`

	// Computed at Provision.
	allowAny  bool
	originSet map[string]struct{}
	logger    *zap.Logger
}

// CaddyModule registers this handler under
// http.handlers.rioku_cors.
func (CORS) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_cors",
		New: func() caddy.Module { return new(CORS) },
	}
}

// Provision normalises defaults and rejects internally inconsistent
// configurations (notably the credentials + wildcard combo, which
// every conformant browser refuses to honour).
func (c *CORS) Provision(ctx caddy.Context) error {
	c.logger = ctx.Logger()

	if len(c.AllowedOrigins) == 0 {
		return fmt.Errorf("rioku_cors: allowed_origins must not be empty")
	}

	c.originSet = make(map[string]struct{}, len(c.AllowedOrigins))
	for _, o := range c.AllowedOrigins {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		if o == "*" {
			c.allowAny = true
			continue
		}
		c.originSet[o] = struct{}{}
	}
	if !c.allowAny && len(c.originSet) == 0 {
		return fmt.Errorf("rioku_cors: allowed_origins contained only blank entries")
	}

	if c.allowAny && c.AllowCredentials {
		return fmt.Errorf("rioku_cors: allow_credentials cannot be combined with wildcard origin %q per the Fetch spec", "*")
	}

	if len(c.AllowedMethods) == 0 {
		c.AllowedMethods = []string{
			http.MethodGet,
			http.MethodHead,
			http.MethodPost,
			http.MethodOptions,
		}
	}

	if c.MaxAgeSeconds == 0 {
		c.MaxAgeSeconds = 600
	}
	if c.MaxAgeSeconds < 0 {
		return fmt.Errorf("rioku_cors: max_age_seconds must be >= 0 (got %d)", c.MaxAgeSeconds)
	}

	return nil
}

// Validate is invoked by Caddy after Provision. The Provision-time
// checks above already cover the same surface, so Validate is a
// no-op for now. Reserved for future cross-field validation.
func (c *CORS) Validate() error { return nil }

// ServeHTTP applies the CORS policy. Preflight (OPTIONS with an
// Access-Control-Request-Method header) is answered with 204 directly
// — the upstream is never contacted. Non-preflight requests get the
// appropriate Access-Control-Allow-Origin / Vary / Expose-Headers
// headers and are passed to the next handler.
func (c *CORS) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	origin := r.Header.Get("Origin")
	matched, ok := c.matchOrigin(origin)

	if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
		// Preflight. Respond directly with 204 regardless of
		// whether the origin matched — when it doesn't match we
		// simply omit the CORS headers, which is enough to make
		// the browser block the actual request.
		c.applyPreflightHeaders(w, r, matched, ok)
		w.WriteHeader(http.StatusNoContent)
		return nil
	}

	// Simple / actual request. Always advertise that the response
	// varies on Origin so caches keep per-origin entries.
	w.Header().Add("Vary", "Origin")
	if ok {
		w.Header().Set("Access-Control-Allow-Origin", matched)
		if c.AllowCredentials {
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if len(c.ExposeHeaders) > 0 {
			w.Header().Set("Access-Control-Expose-Headers", strings.Join(c.ExposeHeaders, ", "))
		}
	}

	return next.ServeHTTP(w, r)
}

// matchOrigin returns the Access-Control-Allow-Origin value to send
// and a boolean indicating whether a match was found. When the
// wildcard is configured and credentials are disabled the literal
// "*" is returned; otherwise the matched origin is echoed back
// verbatim (which is required when credentials are enabled, and
// recommended in general so that intermediate caches can correctly
// vary on Origin).
func (c *CORS) matchOrigin(origin string) (string, bool) {
	if origin == "" {
		return "", false
	}
	if _, exact := c.originSet[origin]; exact {
		return origin, true
	}
	if c.allowAny {
		if c.AllowCredentials {
			// Defensive: Provision should have rejected this
			// combo, but if a JSON config bypasses the
			// Caddyfile path we still echo the origin rather
			// than emit a non-compliant "*" response.
			return origin, true
		}
		return "*", true
	}
	return "", false
}

// applyPreflightHeaders sets the Access-Control-* response headers
// for a preflight reply. When ok is false the headers are omitted,
// which yields a 204 with no CORS metadata — the browser then
// blocks the subsequent actual request on the client side.
func (c *CORS) applyPreflightHeaders(w http.ResponseWriter, r *http.Request, matched string, ok bool) {
	// Vary advertises that the cached preflight reply depends on
	// the Origin and the requested method/headers. Set this even
	// when the origin doesn't match so caches keep per-origin
	// entries.
	w.Header().Add("Vary", "Origin")
	w.Header().Add("Vary", "Access-Control-Request-Method")
	w.Header().Add("Vary", "Access-Control-Request-Headers")

	if !ok {
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", matched)
	if c.AllowCredentials {
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}

	// Methods: prefer echoing the requested method when the
	// configured set covers it; otherwise emit the full configured
	// list so the browser knows what's permitted on subsequent
	// requests.
	requestedMethod := r.Header.Get("Access-Control-Request-Method")
	if requestedMethod != "" && c.methodAllowed(requestedMethod) {
		w.Header().Set("Access-Control-Allow-Methods", requestedMethod)
	} else {
		w.Header().Set("Access-Control-Allow-Methods", strings.Join(c.AllowedMethods, ", "))
	}

	// Headers: when the operator configured an explicit list, send
	// it. Otherwise reflect whatever the browser asked for — this
	// keeps the developer experience smooth without requiring an
	// exhaustive header allow-list up front.
	if len(c.AllowedHeaders) > 0 {
		w.Header().Set("Access-Control-Allow-Headers", strings.Join(c.AllowedHeaders, ", "))
	} else if reqHeaders := r.Header.Get("Access-Control-Request-Headers"); reqHeaders != "" {
		w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
	}

	w.Header().Set("Access-Control-Max-Age", strconv.Itoa(c.MaxAgeSeconds))
}

// methodAllowed reports whether the requested method is in the
// configured AllowedMethods list. Comparison is case-insensitive
// because RFC 9110 requires methods to be matched case-sensitively
// in general but real-world preflight requests have been seen with
// lower-case methods from older clients.
func (c *CORS) methodAllowed(method string) bool {
	method = strings.ToUpper(strings.TrimSpace(method))
	for _, m := range c.AllowedMethods {
		if strings.ToUpper(m) == method {
			return true
		}
	}
	return false
}

// UnmarshalCaddyfile parses a Caddyfile block:
//
//	rioku_cors {
//	    allowed_origins https://app.example.com https://admin.example.com
//	    allowed_methods GET POST PUT DELETE OPTIONS
//	    allowed_headers Authorization Content-Type X-Rioku-Tenant
//	    expose_headers X-Request-ID
//	    max_age_seconds 3600
//	    allow_credentials true
//	}
func (c *CORS) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "allowed_origins":
				c.AllowedOrigins = append(c.AllowedOrigins, d.RemainingArgs()...)
			case "allowed_methods":
				c.AllowedMethods = append(c.AllowedMethods, d.RemainingArgs()...)
			case "allowed_headers":
				c.AllowedHeaders = append(c.AllowedHeaders, d.RemainingArgs()...)
			case "expose_headers":
				c.ExposeHeaders = append(c.ExposeHeaders, d.RemainingArgs()...)
			case "max_age_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &c.MaxAgeSeconds); err != nil {
					return d.Errf("invalid max_age_seconds %q: %v", v, err)
				}
			case "allow_credentials":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				switch strings.ToLower(v) {
				case "true", "yes", "on", "1":
					c.AllowCredentials = true
				case "false", "no", "off", "0":
					c.AllowCredentials = false
				default:
					return d.Errf("invalid allow_credentials %q (expected true/false)", v)
				}
			default:
				return d.Errf("unknown rioku_cors directive: %q", d.Val())
			}
		}
	}
	return nil
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var c CORS
	if err := c.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &c, nil
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*CORS)(nil)
	_ caddy.Validator             = (*CORS)(nil)
	_ caddyhttp.MiddlewareHandler = (*CORS)(nil)
	_ caddyfile.Unmarshaler       = (*CORS)(nil)
)
