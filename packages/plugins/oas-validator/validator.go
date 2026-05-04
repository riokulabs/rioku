// Package oasvalidator implements the first-party Rioku OpenAPI request
// validator Caddy module. It validates inbound HTTP requests against an
// OpenAPI 3 (or Swagger 2 — kin-openapi auto-converts) specification
// before they reach upstream services.
//
// Behaviour summary:
//
//   - Spec source is exactly one of OASURL or OASInline. The daemon
//     resolves vault references in OASURL at compile time, so this
//     module always sees a plain URL or plain spec literal.
//   - Routes that don't match any operation in the spec either pass
//     through (RejectUnknown=false, default) or get a 404 with an RFC
//     7807 problem document (RejectUnknown=true). This lets operators
//     incrementally adopt OAS validation on a subset of paths.
//   - Routes that do match are validated. Validation failures return
//     a 400 with an RFC 7807 problem document including a structured
//     errors array — each entry carries a JSON pointer indicating which
//     field failed.
//   - When OASURL is set with a positive RefreshIntervalSeconds, a
//     background goroutine re-fetches the spec on the configured
//     cadence. Refresh failures keep the previously-loaded spec and
//     log a warning; they do not take the handler offline.
//
// Compiled into Caddy via the bundled rioku-caddy binary.
package oasvalidator

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync/atomic"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(Validator{})
	httpcaddyfile.RegisterHandlerDirective("rioku_oas_validator", parseCaddyfileHandler)
}

// Validator is a Caddy handler that validates inbound requests against
// an OpenAPI 3 specification. Each module instance owns its own spec
// snapshot — multiple instances may be configured against different
// specs on different routes.
type Validator struct {
	// OASURL is the URL of the OpenAPI 3 (or Swagger 2) spec. Mutually
	// exclusive with OASInline. Vault references are resolved by the
	// daemon before this module sees the value.
	OASURL string `json:"oas_url,omitempty"`

	// OASInline is the OpenAPI spec content as a string (YAML or
	// JSON). Mutually exclusive with OASURL. Useful when the operator
	// wants to inline the spec directly in their config.
	OASInline string `json:"oas_inline,omitempty"`

	// RefreshIntervalSeconds is how often to re-fetch when OASURL is
	// set. Zero (the default) fetches once at Provision and never
	// refreshes. Positive values start a background refresh
	// goroutine. Negative values are clamped to zero.
	RefreshIntervalSeconds int `json:"refresh_interval_seconds,omitempty"`

	// ValidateRequestBody controls whether request bodies are
	// validated against the operation's requestBody schema. Defaults
	// to true.
	ValidateRequestBody bool `json:"validate_request_body,omitempty"`

	// ValidateRequestParams controls whether path/query parameters
	// are validated. Defaults to true.
	ValidateRequestParams bool `json:"validate_request_params,omitempty"`

	// RejectUnknown controls handler behaviour when no operation in
	// the spec matches the inbound request's path+method. When true
	// the handler returns 404 with an RFC 7807 problem document.
	// When false (the default) the request passes through to the
	// next handler unvalidated — useful when only some routes are
	// OAS-governed.
	RejectUnknown bool `json:"reject_unknown,omitempty"`

	// validateBody / validateParams resolve the JSON-omitempty
	// "default true" problem: omitempty drops false values, so we
	// can't tell "operator explicitly set false" from "operator
	// omitted the field". The Caddyfile + JSON paths set these
	// internal mirrors based on the public flags + provision-time
	// defaults.
	validateBody   bool
	validateParams bool

	loader      *specLoader
	router      *atomic.Pointer[routers.Router]
	stopRefresh chan struct{}
	logger      *zap.Logger
}

// CaddyModule registers the handler under
// http.handlers.rioku_oas_validator.
func (Validator) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_oas_validator",
		New: func() caddy.Module { return new(Validator) },
	}
}

// Provision loads the spec, builds the router, and (when configured)
// starts the background refresh goroutine. Failure to load the initial
// spec aborts Provision so misconfigurations surface at config load
// rather than per-request.
func (v *Validator) Provision(ctx caddy.Context) error {
	v.logger = ctx.Logger()

	if v.OASURL == "" && v.OASInline == "" {
		return errors.New("rioku_oas_validator: one of oas_url or oas_inline is required")
	}
	if v.OASURL != "" && v.OASInline != "" {
		return errors.New("rioku_oas_validator: oas_url and oas_inline are mutually exclusive")
	}
	if v.RefreshIntervalSeconds < 0 {
		v.RefreshIntervalSeconds = 0
	}

	// Default the validate flags to true. The struct zero-value is
	// false, but the operator-friendly default is "validate
	// everything". We mirror to internal fields so a runtime tweak
	// of the public flag doesn't desync.
	v.validateBody = v.ValidateRequestBody
	v.validateParams = v.ValidateRequestParams
	if !v.validateBody && !v.validateParams {
		// All-false is almost certainly the operator-omitted case
		// (struct zero value). Apply the documented defaults.
		v.validateBody = true
		v.validateParams = true
		v.ValidateRequestBody = true
		v.ValidateRequestParams = true
	}

	v.loader = newSpecLoader(v.OASURL, v.OASInline, v.logger)
	// Allocate the atomic pointer on the heap so the embedding
	// Validator struct stays trivially copyable (Caddy invokes
	// CaddyModule() on zero-value instances at registration time —
	// embedding atomic.Pointer directly trips go vet).
	v.router = &atomic.Pointer[routers.Router]{}

	doc, err := v.loader.Load(ctx)
	if err != nil {
		return fmt.Errorf("rioku_oas_validator: load spec: %w", err)
	}
	if err := v.installRouter(doc); err != nil {
		return fmt.Errorf("rioku_oas_validator: build router: %w", err)
	}

	if v.OASURL != "" && v.RefreshIntervalSeconds > 0 {
		v.stopRefresh = make(chan struct{})
		go v.refreshLoop()
	}

	return nil
}

// Validate is invoked after Provision. The Provision-time checks above
// already cover the required surface, so Validate is a no-op for now.
func (v *Validator) Validate() error { return nil }

// Cleanup stops the background refresh goroutine, if any. Caddy calls
// Cleanup when the module is being torn down (config reload, shutdown).
// The channel is closed once and never reassigned to keep concurrent
// access from the refresh goroutine race-free.
func (v *Validator) Cleanup() error {
	if v.stopRefresh != nil {
		select {
		case <-v.stopRefresh:
			// Already closed by a previous Cleanup call.
		default:
			close(v.stopRefresh)
		}
	}
	return nil
}

// ServeHTTP validates the inbound request against the active spec.
// Validation outcomes:
//
//   - No operation matches: pass through (RejectUnknown=false) or 404
//     (RejectUnknown=true).
//   - Operation matches and request is valid: forward to next handler.
//   - Operation matches and request is invalid: 400 with RFC 7807 body.
func (v *Validator) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	router := v.router.Load()
	if router == nil {
		// Should never happen — Provision installs a router before
		// returning. Treat as a server error rather than panic.
		writeProblem(w, http.StatusInternalServerError, problem{
			Type:   problemTypeURI,
			Title:  "OpenAPI validator not provisioned",
			Status: http.StatusInternalServerError,
			Detail: "router not installed",
		})
		return nil
	}

	route, pathParams, err := (*router).FindRoute(r)
	if err != nil {
		// No matching operation. Pass through unless RejectUnknown
		// is set.
		if !v.RejectUnknown {
			return next.ServeHTTP(w, r)
		}
		writeProblem(w, http.StatusNotFound, problem{
			Type:   problemTypeURI,
			Title:  "Route not defined in OpenAPI spec",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("no operation matches %s %s", r.Method, r.URL.Path),
		})
		return nil
	}

	input := &openapi3filter.RequestValidationInput{
		Request:    r,
		PathParams: pathParams,
		Route:      route,
		Options: &openapi3filter.Options{
			MultiError:                true,
			ExcludeRequestBody:        !v.validateBody,
			ExcludeRequestQueryParams: !v.validateParams,
			// Authentication is the responsibility of the auth-jwt
			// or auth-apikey handlers earlier in the chain — skip
			// here so missing security definitions don't trip up
			// otherwise-valid requests.
			AuthenticationFunc: noopAuth,
		},
	}

	if err := openapi3filter.ValidateRequest(r.Context(), input); err != nil {
		prob := buildValidationProblem(err)
		writeProblem(w, http.StatusBadRequest, prob)
		return nil
	}

	return next.ServeHTTP(w, r)
}

// installRouter swaps in a freshly-built router for the given spec doc.
// Atomic pointer swap ensures concurrent ServeHTTP calls see a
// consistent router.
func (v *Validator) installRouter(doc *openapi3.T) error {
	r, err := buildRouter(doc)
	if err != nil {
		return err
	}
	v.router.Store(&r)
	return nil
}

// noopAuth lets requests through the openapi3filter security check.
// Auth is enforced by upstream Caddy handlers.
func noopAuth(_ context.Context, _ *openapi3filter.AuthenticationInput) error {
	return nil
}

// UnmarshalCaddyfile parses a Caddyfile block:
//
//	rioku_oas_validator {
//	    oas_url https://example.com/openapi.yaml
//	    oas_inline "<yaml or json string>"
//	    refresh_interval_seconds 300
//	    validate_request_body true
//	    validate_request_params true
//	    reject_unknown false
//	}
func (v *Validator) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	// Track whether the operator explicitly set the validate flags;
	// if not, we apply the documented "default true" at Provision.
	var explicitBody, explicitParams bool

	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "oas_url":
				if !d.Args(&v.OASURL) {
					return d.ArgErr()
				}
			case "oas_inline":
				if !d.Args(&v.OASInline) {
					return d.ArgErr()
				}
			case "refresh_interval_seconds":
				var s string
				if !d.Args(&s) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(s, "%d", &v.RefreshIntervalSeconds); err != nil {
					return d.Errf("invalid refresh_interval_seconds %q: %v", s, err)
				}
			case "validate_request_body":
				b, err := parseBoolArg(d)
				if err != nil {
					return err
				}
				v.ValidateRequestBody = b
				explicitBody = true
			case "validate_request_params":
				b, err := parseBoolArg(d)
				if err != nil {
					return err
				}
				v.ValidateRequestParams = b
				explicitParams = true
			case "reject_unknown":
				b, err := parseBoolArg(d)
				if err != nil {
					return err
				}
				v.RejectUnknown = b
			default:
				return d.Errf("unknown rioku_oas_validator directive: %q", d.Val())
			}
		}
	}

	// If the operator omitted the validate flags entirely, mark them
	// true so Provision doesn't apply the all-false-means-default
	// fallback (which would also set them true, but the explicit
	// signal is clearer).
	if !explicitBody {
		v.ValidateRequestBody = true
	}
	if !explicitParams {
		v.ValidateRequestParams = true
	}

	return nil
}

func parseBoolArg(d *caddyfile.Dispenser) (bool, error) {
	var s string
	if !d.Args(&s) {
		return false, d.ArgErr()
	}
	switch s {
	case "true", "yes", "1", "on":
		return true, nil
	case "false", "no", "0", "off":
		return false, nil
	default:
		return false, d.Errf("invalid bool %q (use true|false)", s)
	}
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var v Validator
	if err := v.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &v, nil
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*Validator)(nil)
	_ caddy.Validator             = (*Validator)(nil)
	_ caddy.CleanerUpper          = (*Validator)(nil)
	_ caddyhttp.MiddlewareHandler = (*Validator)(nil)
	_ caddyfile.Unmarshaler       = (*Validator)(nil)
)
