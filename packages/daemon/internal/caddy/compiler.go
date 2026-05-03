// compiler.go compiles rioku config (routes, services, policies) into
// Caddy JSON configuration for push via the admin API.
package caddy

import (
	"encoding/json"
	"fmt"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// AdminConfig controls how the admin server block is compiled.
type AdminConfig struct {
	// InternalAddr is the loopback address the Go net/http gateway is bound to,
	// e.g. "127.0.0.1:54321". The compiler uses this as the reverse_proxy upstream.
	InternalAddr string

	// ListenAddr is the external address Caddy listens on for admin traffic.
	// Defaults to ":7778" when empty.
	ListenAddr string

	// Domain is the optional dedicated admin domain (e.g. "admin.example.com").
	// When set, the admin server listens on ":443" and Caddy provisions auto-TLS.
	Domain string

	// DevMode disables TLS on the admin block (HTTP only).
	DevMode bool
}

// TrustedProxiesConfig specifies which CIDR sources Caddy trusts for
// X-Forwarded-For / client IP resolution.
//
// Static contains always-trusted CIDR ranges. Dynamic holds a list of
// named strategies (e.g. "cloudflare", "static-url") that are refreshed
// periodically. Each entry corresponds to one TrustedProxiesDynamic proto
// value stored in the daemon config.
type TrustedProxiesConfig struct {
	// Ranges are always-trusted CIDR ranges (static sources).
	// e.g. ["10.0.0.0/8", "172.16.0.0/12"]
	Ranges []string

	// Dynamic holds entries for dynamic CIDR strategies.
	Dynamic []TrustedProxiesDynamicConfig
}

// TrustedProxiesDynamicConfig is the Go-level representation of one dynamic
// trusted-proxy strategy, mirroring the TrustedProxiesDynamic proto message.
type TrustedProxiesDynamicConfig struct {
	// Strategy is the source name: "cloudflare" or "static" (URL-based refresh).
	Strategy string

	// URL is the refresh endpoint for the "static" strategy.
	URL string

	// RefreshSeconds is how often to re-fetch. Zero uses the default (3600s).
	RefreshSeconds int32
}

// SecurityHeadersConfig controls which security response headers the compiler
// injects into every proxied response. The struct mirrors config.SecurityHeaders
// but lives in the caddy package to avoid a circular import (config -> caddy).
type SecurityHeadersConfig struct {
	Enabled             bool
	XContentTypeOptions string
	XFrameOptions       string
	ReferrerPolicy      string
	PermissionsPolicy   string
	CSP                 string
	CSPReportOnly       bool
	HSTS                HSTSConfig
}

// HSTSConfig controls the HTTP Strict Transport Security header.
type HSTSConfig struct {
	Enabled           bool
	MaxAge            int
	IncludeSubdomains bool
}

// OnDemandTLSConfig controls Caddy's on-demand TLS automation. When
// Enabled is true the compiler emits an `apps.tls.automation.on_demand.ask`
// URL pointing at AskURL — Caddy calls into that URL during the TLS
// handshake to validate that an unknown SNI matches a configured route.
// This is the security gate from issue #66.
type OnDemandTLSConfig struct {
	// Enabled turns the entire feature on. When false the compiler
	// emits no TLS automation block and Caddy falls back to its
	// default certificate-management behavior.
	Enabled bool

	// AskURL is the absolute URL Caddy will call to validate an SNI.
	// Typically "http://127.0.0.1:7790/tls/ask" — must be reachable
	// from the Caddy process. Required when Enabled is true.
	AskURL string

	// IntervalSeconds and Burst are passed through to Caddy's
	// `apps.tls.automation.on_demand.rate_limit` block when both are
	// > 0. They form a secondary defence on top of the ask gate
	// against runaway issuance attempts.
	IntervalSeconds int
	Burst           int
}

// Compiler converts Rioku config into Caddy JSON.
type Compiler struct {
	trafficAddrs    []string
	admin           AdminConfig
	traceSocketPath string
	trustedProxies  *TrustedProxiesConfig
	securityHeaders SecurityHeadersConfig
	onDemandTLS     OnDemandTLSConfig
}

// NewCompiler creates a compiler with the given traffic listen addresses, admin config,
// optional trace socket path, optional trusted proxy config, and security headers config.
// When traceSocketPath is non-empty, the compiled Caddy config will include a logging
// block that sends access logs to the socket. When trustedProxies is non-nil with ranges,
// each server block will include trusted_proxies for correct client IP resolution.
func NewCompiler(trafficAddrs []string, admin AdminConfig, traceSocketPath string, trustedProxies *TrustedProxiesConfig, secHeaders SecurityHeadersConfig) *Compiler {
	addrs := make([]string, len(trafficAddrs))
	copy(addrs, trafficAddrs)
	return &Compiler{trafficAddrs: addrs, admin: admin, traceSocketPath: traceSocketPath, trustedProxies: trustedProxies, securityHeaders: secHeaders}
}

// SetOnDemandTLS enables (or disables) on-demand TLS provisioning in
// future Compile() calls. Callers are expected to invoke this after
// construction once the daemon knows the local AskURL.
func (c *Compiler) SetOnDemandTLS(cfg OnDemandTLSConfig) {
	c.onDemandTLS = cfg
}

// CompileWithPlugins compiles the snapshot with the supplied per-route
// plugin configuration (#171 OAS validator, #172 Coraza WAF). It is
// the entry point used by config.Engine when it has loaded the
// per-route plugin maps inside the same store transaction as the
// snapshot. Test callers and the bare Compile method use this with
// an empty PerRoutePlugins value.
//
// CompileWithPlugins does not mutate the receiver — the per-route
// configuration is threaded down to each CompileRoute call, so the
// compiler remains safe for concurrent use across goroutines.
func (c *Compiler) CompileWithPlugins(snapshot *riokuv1.ConfigSnapshot, perRoute PerRoutePlugins) ([]byte, error) {
	return c.compile(snapshot, perRoute)
}

// Compile takes the full Rioku config snapshot and produces Caddy JSON.
// The returned bytes are ready to POST to Caddy's /load admin endpoint.
//
// Compile is equivalent to CompileWithPlugins with no per-route plugin
// configuration — every route gets the standard handler chain
// (tracing -> security headers -> vars -> [compression] ->
// [request headers] -> reverse_proxy). Callers that need per-route
// OAS or WAF handlers (#171, #172) must use CompileWithPlugins.
func (c *Compiler) Compile(snapshot *riokuv1.ConfigSnapshot) ([]byte, error) {
	return c.compile(snapshot, PerRoutePlugins{})
}

// compile is the shared implementation of Compile and CompileWithPlugins.
// It threads the per-route plugin map through CompileRoute so the
// receiver stays free of per-call mutable state and Compile remains
// safe for concurrent use.
func (c *Compiler) compile(snapshot *riokuv1.ConfigSnapshot, perRoute PerRoutePlugins) ([]byte, error) {
	// Build service lookup map keyed by service ID.
	services := make(map[string]*riokuv1.Service, len(snapshot.GetServices()))
	for _, svc := range snapshot.GetServices() {
		services[svc.GetId()] = svc
	}

	var caddyRoutes []map[string]any
	for _, route := range snapshot.GetRoutes() {
		if !route.GetEnabled() {
			continue
		}
		compiled, err := c.compileRoute(route, services, perRoute)
		if err != nil {
			return nil, fmt.Errorf("compiling route %q: %w", route.GetId(), err)
		}
		caddyRoutes = append(caddyRoutes, compiled)
	}

	// Ensure routes is an empty array, not null, when there are no routes.
	if caddyRoutes == nil {
		caddyRoutes = []map[string]any{}
	}

	servers := map[string]any{
		"traffic": map[string]any{
			"listen": c.trafficAddrs,
			"routes": caddyRoutes,
		},
	}

	if c.admin.InternalAddr != "" {
		servers["admin"] = c.buildAdminServer()
	}

	// Enable access logging on the traffic server.
	if c.traceSocketPath != "" {
		trafficSrv := servers["traffic"].(map[string]any)
		trafficSrv["logs"] = map[string]any{
			"default_logger_name": "rioku",
		}
	}

	// Add trusted_proxies to all server blocks when configured.
	if tp := buildTrustedProxiesBlock(c.trustedProxies); tp != nil {
		for _, srv := range servers {
			if s, ok := srv.(map[string]any); ok {
				s["trusted_proxies"] = tp
			}
		}
	}

	// When using non-standard ports (not :443/:80), disable auto-HTTPS
	// entirely. ACME challenges need :80/:443, and internal/dev traffic
	// ports should not provision TLS certificates for host matchers.
	if !c.hasStandardPorts() {
		for _, srv := range servers {
			if s, ok := srv.(map[string]any); ok {
				s["automatic_https"] = map[string]any{
					"disable": true,
				}
			}
		}
	}

	apps := map[string]any{
		"http": map[string]any{
			"servers": servers,
			"metrics": map[string]any{}, // Prometheus metrics at root http level
		},
	}

	if tls := c.buildTLSApp(); tls != nil {
		apps["tls"] = tls
	}

	config := map[string]any{
		"apps": apps,
	}

	if c.traceSocketPath != "" {
		config["logging"] = map[string]any{
			"logs": map[string]any{
				"rioku_trace": map[string]any{
					"writer": map[string]any{
						"output":  "net",
						"address": "unix/" + c.traceSocketPath,
					},
					"encoder": map[string]any{
						"format": "json",
					},
					"include": []string{"http.log.access.rioku"},
				},
			},
		}
	}

	return json.Marshal(config)
}

// hasStandardPorts returns true if the traffic addresses include :443 or :80,
// meaning Caddy's auto-HTTPS redirect to port 80 would be appropriate.
func (c *Compiler) hasStandardPorts() bool {
	for _, addr := range c.trafficAddrs {
		if addr == ":443" || addr == ":80" {
			return true
		}
	}
	return false
}
