// Package canary implements the first-party Rioku weighted canary
// Caddy handler. It picks between a primary and a canary upstream
// based on a configurable weight, with optional session affinity
// keyed on a request header.
//
// The handler does NOT proxy on its own — it rewrites
// r.URL.Host/r.URL.Scheme to point at the chosen upstream and then
// invokes the next handler in the chain (expected to be
// reverse_proxy or equivalent). This keeps the module focused on
// the routing decision and lets Caddy's reverse-proxy do the
// actual transport work.
//
// See issue #177 (Sprint 6 Phase 2) for the spec. v1 implements the
// weighted split + sticky-affinity surface; comparing latency /
// error_rate / status_codes between primary and canary
// (compare_metrics) is a follow-up.
package canary

import (
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(Canary{})
	httpcaddyfile.RegisterHandlerDirective("rioku_canary", parseCaddyfileHandler)
}

// Default values.
const (
	defaultCanaryWeight = 0.05
	defaultStickyTTL    = time.Hour
)

// upstreamChoice is the routing decision recorded for a sticky
// session.
type upstreamChoice int

const (
	choicePrimary upstreamChoice = iota
	choiceCanary
)

// stickyEntry is the value stored in the affinity map. It records
// both the routing decision and the time it was last refreshed so
// stale entries can be evicted.
type stickyEntry struct {
	choice  upstreamChoice
	updated time.Time
}

// Canary is a Caddy handler that splits traffic between a primary
// upstream and a canary upstream by configurable weight, with
// optional header-keyed session affinity.
type Canary struct {
	// PrimaryUpstream is the URL of the stable upstream. Required.
	// Must parse as an absolute URL with scheme + host.
	PrimaryUpstream string `json:"primary_upstream,omitempty"`

	// CanaryUpstream is the URL of the canary upstream. Required.
	// Must parse as an absolute URL with scheme + host.
	CanaryUpstream string `json:"canary_upstream,omitempty"`

	// CanaryWeight is the fraction of traffic (0.0 - 1.0) routed
	// to the canary upstream. Default 0.05 (5%). Values outside
	// [0, 1] cause Provision to fail.
	CanaryWeight float64 `json:"canary_weight,omitempty"`

	// StickyHeader, when non-empty, names a request header whose
	// value keys an in-memory affinity map. A request whose value
	// is already in the map is routed to the recorded upstream;
	// otherwise the random sample decides and the result is
	// recorded for subsequent requests with the same value.
	StickyHeader string `json:"sticky_header,omitempty"`

	// StickyTTLSeconds bounds how long affinity entries are kept.
	// Default 3600 (one hour). Negative or zero values fall back
	// to the default. Useful primarily for tests; production
	// operators rarely need to tune it.
	StickyTTLSeconds int `json:"sticky_ttl_seconds,omitempty"`

	// Computed at Provision.
	primaryURL *url.URL
	canaryURL  *url.URL
	stickyTTL  time.Duration
	affinity   sync.Map // string -> *stickyEntry
	logger     *zap.Logger
}

// CaddyModule registers this handler under
// http.handlers.rioku_canary.
func (Canary) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_canary",
		New: func() caddy.Module { return new(Canary) },
	}
}

// Provision validates configuration and parses the upstream URLs.
// Fails fast on invalid weights or unparseable URLs so operators
// learn at config-load time rather than on the first request.
func (c *Canary) Provision(ctx caddy.Context) error {
	c.logger = ctx.Logger()

	if c.PrimaryUpstream == "" {
		return fmt.Errorf("rioku_canary: primary_upstream is required")
	}
	if c.CanaryUpstream == "" {
		return fmt.Errorf("rioku_canary: canary_upstream is required")
	}

	pu, err := parseUpstream(c.PrimaryUpstream)
	if err != nil {
		return fmt.Errorf("rioku_canary: primary_upstream: %w", err)
	}
	cu, err := parseUpstream(c.CanaryUpstream)
	if err != nil {
		return fmt.Errorf("rioku_canary: canary_upstream: %w", err)
	}
	c.primaryURL = pu
	c.canaryURL = cu

	// CanaryWeight is validated as-is. Zero is a legitimate value
	// (canary disabled while keeping the handler in the chain for
	// sticky-affinity continuity); operators that want the 5%
	// default must omit the field entirely from JSON, in which
	// case Go's zero-value lands here. The Caddyfile parser
	// substitutes the default when the directive is absent so the
	// "5% default" promise still holds at the config-language
	// level. Programmatic users get explicit-control semantics.
	if c.CanaryWeight < 0 || c.CanaryWeight > 1 {
		return fmt.Errorf("rioku_canary: canary_weight %v out of range [0, 1]", c.CanaryWeight)
	}

	if c.StickyTTLSeconds <= 0 {
		c.stickyTTL = defaultStickyTTL
	} else {
		c.stickyTTL = time.Duration(c.StickyTTLSeconds) * time.Second
	}

	return nil
}

// Validate is invoked by Caddy after Provision. Provision already
// covers the validation surface; reserved for future use.
func (c *Canary) Validate() error { return nil }

// ServeHTTP picks an upstream and rewrites r.URL.Host/Scheme before
// calling next. The next handler is expected to honour the rewritten
// URL (reverse_proxy with `to {http.request.scheme}://{http.request.host}`
// or equivalent dynamic upstream binding).
func (c *Canary) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	choice := c.pickUpstream(r)

	target := c.primaryURL
	if choice == choiceCanary {
		target = c.canaryURL
	}

	r.URL.Scheme = target.Scheme
	r.URL.Host = target.Host

	if c.logger != nil {
		c.logger.Debug("canary routing decision",
			zap.String("upstream", target.String()),
			zap.Bool("canary", choice == choiceCanary),
		)
	}

	return next.ServeHTTP(w, r)
}

// pickUpstream applies the affinity-then-sample policy and records
// the result when sticky routing is enabled.
func (c *Canary) pickUpstream(r *http.Request) upstreamChoice {
	stickyKey := ""
	if c.StickyHeader != "" {
		stickyKey = r.Header.Get(c.StickyHeader)
	}

	if stickyKey != "" {
		if existing, ok := c.loadSticky(stickyKey); ok {
			// Refresh the entry's timestamp so an actively used
			// session keeps its affinity beyond the TTL window.
			c.storeSticky(stickyKey, existing)
			return existing
		}
	}

	choice := choicePrimary
	if rand.Float64() < c.CanaryWeight {
		choice = choiceCanary
	}

	if stickyKey != "" {
		c.storeSticky(stickyKey, choice)
	}

	return choice
}

// loadSticky returns the recorded choice for key when it exists and
// has not expired. Expired entries are evicted in-line so the map
// does not grow unbounded for short-lived sessions.
func (c *Canary) loadSticky(key string) (upstreamChoice, bool) {
	v, ok := c.affinity.Load(key)
	if !ok {
		return choicePrimary, false
	}
	entry, ok := v.(*stickyEntry)
	if !ok || entry == nil {
		c.affinity.Delete(key)
		return choicePrimary, false
	}
	if time.Since(entry.updated) > c.stickyTTL {
		c.affinity.Delete(key)
		return choicePrimary, false
	}
	return entry.choice, true
}

// storeSticky writes (or refreshes) the affinity entry for key.
func (c *Canary) storeSticky(key string, choice upstreamChoice) {
	c.affinity.Store(key, &stickyEntry{
		choice:  choice,
		updated: time.Now(),
	})
}

// parseUpstream parses a user-supplied upstream URL and rejects
// values that lack a scheme or host (those would silently break
// the downstream reverse_proxy).
func parseUpstream(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid url %q: %w", raw, err)
	}
	if u.Scheme == "" {
		return nil, fmt.Errorf("url %q has no scheme", raw)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("url %q has no host", raw)
	}
	return u, nil
}

// UnmarshalCaddyfile parses a Caddyfile block:
//
//	rioku_canary {
//	    primary_upstream http://primary.internal:8080
//	    canary_upstream http://canary.internal:8080
//	    canary_weight 0.10
//	    sticky_header X-Session-Id
//	    sticky_ttl_seconds 3600
//	}
func (c *Canary) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	weightSet := false
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "primary_upstream":
				if !d.Args(&c.PrimaryUpstream) {
					return d.ArgErr()
				}
			case "canary_upstream":
				if !d.Args(&c.CanaryUpstream) {
					return d.ArgErr()
				}
			case "canary_weight":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%f", &c.CanaryWeight); err != nil {
					return d.Errf("invalid canary_weight %q: %v", v, err)
				}
				weightSet = true
			case "sticky_header":
				if !d.Args(&c.StickyHeader) {
					return d.ArgErr()
				}
			case "sticky_ttl_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &c.StickyTTLSeconds); err != nil {
					return d.Errf("invalid sticky_ttl_seconds %q: %v", v, err)
				}
			default:
				return d.Errf("unknown rioku_canary directive: %q", d.Val())
			}
		}
	}
	// Caddyfile-level default: when canary_weight is omitted,
	// fall back to 5%. Programmatic JSON users keep explicit-zero
	// semantics — they can opt into the default by omitting the
	// field entirely (Go zero-value) and accepting "0% canary".
	if !weightSet {
		c.CanaryWeight = defaultCanaryWeight
	}
	return nil
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var c Canary
	if err := c.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &c, nil
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*Canary)(nil)
	_ caddy.Validator             = (*Canary)(nil)
	_ caddyhttp.MiddlewareHandler = (*Canary)(nil)
	_ caddyfile.Unmarshaler       = (*Canary)(nil)
)
