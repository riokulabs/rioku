package caddy

import (
	"fmt"
	"strings"
)

// Per-route plugin configuration the compiler emits as Caddy handler
// chain entries before the reverse_proxy. Storage for these lives in
// route_oas_configs / route_waf_configs (#171, #172). The structs
// below intentionally mirror the store-layer shape but stay
// compiler-package-local so the caddy package does not depend on
// internal/store (avoiding the engine -> compiler -> store cycle).

// RouteOASConfig captures the per-route OpenAPI request validator
// settings the compiler turns into an `http.handlers.rioku_oas_validator`
// entry. Exactly one of OASURL / OASInline must be non-empty; the
// compiler skips emission when both are empty (treated as "not
// configured", same as no row in the table).
type RouteOASConfig struct {
	OASURL                 string
	OASInline              string
	RefreshIntervalSeconds int32
	ValidateRequestBody    bool
	ValidateRequestParams  bool
	RejectUnknown          bool
}

// WAFMode mirrors store.WAFMode (kept as plain string here to avoid
// the store import). Valid values: "block", "detect_only".
type WAFMode string

const (
	WAFModeBlock      WAFMode = "block"
	WAFModeDetectOnly WAFMode = "detect_only"
)

// RouteWAFConfig captures the per-route Coraza WAF settings the
// compiler turns into an `http.handlers.waf` entry. The Coraza Caddy
// module accepts a `directives` string + `load_owasp_crs` bool; the
// per-route knobs (paranoia level, excluded rule IDs, request body
// limit, mode) are translated into SecAction / SecRuleRemoveById /
// SecRequestBodyLimit / SecRuleEngine directives appended to the
// directives string.
type RouteWAFConfig struct {
	Enabled          bool
	Mode             WAFMode
	RuleSet          string // "crs" loads the OWASP Core Rule Set; other values are passed through as-is
	ParanoiaLevel    int32  // 1-4
	ExcludedRuleIDs  []string
	RequestBodyLimit int32
}

// PerRoutePlugins bundles per-route plugin configuration keyed by
// route ID. The compiler reads these maps when emitting each route's
// handler chain. A nil PerRoutePlugins value is equivalent to
// "no per-route plugins configured" — every route compiles as before.
type PerRoutePlugins struct {
	// OASByRoute maps route ID -> OAS validator config. Only routes
	// with a non-nil entry get an OAS handler emitted.
	OASByRoute map[string]*RouteOASConfig

	// WAFByRoute maps route ID -> WAF config. Only routes with a
	// non-nil entry whose Enabled is true get a WAF handler emitted.
	WAFByRoute map[string]*RouteWAFConfig

	// MCPRoutes is the list of standalone MCP gateway routes (#181,
	// #201). Each entry produces its own Caddy route with hostname +
	// path_prefix matchers and a reverse_proxy handler to the MCP
	// server's URL. Optionally chains rioku_mcp_auth in front of the
	// reverse_proxy for the team-allow-list resolution path.
	MCPRoutes []MCPRouteCompileConfig
}

// MCPRouteAuthMode mirrors store.MCPAuthPassthrough but stays
// compiler-package-local to avoid the store import.
type MCPRouteAuthMode string

const (
	MCPAuthForward MCPRouteAuthMode = "forward"
	MCPAuthReplace MCPRouteAuthMode = "replace"
	MCPAuthStrip   MCPRouteAuthMode = "strip"
)

// MCPRouteCompileConfig is one MCP gateway route (#181, #201). The
// compiler turns each entry into a Caddy route inside the shared
// traffic server with hostname + path matchers and the right
// auth-passthrough handler chain.
type MCPRouteCompileConfig struct {
	ID                string
	TenantID          string
	Hostname          string
	PathPrefix        string
	UpstreamURL       string
	UpstreamCredential string // resolved upstream credential — used for "replace" mode
	AuthPassthrough   MCPRouteAuthMode
	// AuthValidatorEndpoint is the daemon-side rioku_mcp_auth
	// validator URL. Empty disables team-allow-list enforcement
	// (the route still proxies, but tool calls aren't filtered —
	// this matches the v1 MCP-route-only opt-in posture).
	AuthValidatorEndpoint string
}

// buildMCPRoute returns a Caddy route map for the given MCP gateway
// route. Returns nil if UpstreamURL is empty (treated as
// "not configured", same as no row in the table).
func buildMCPRoute(cfg MCPRouteCompileConfig) map[string]any {
	if cfg.UpstreamURL == "" {
		return nil
	}

	// Matcher: hostname AND path_prefix.
	pathPrefix := cfg.PathPrefix
	if pathPrefix == "" {
		pathPrefix = "/"
	}
	match := []map[string]any{{}}
	if cfg.Hostname != "" {
		match[0]["host"] = []string{cfg.Hostname}
	}
	if pathPrefix != "/" {
		match[0]["path"] = []string{pathPrefix + "*"}
	}

	var handlers []map[string]any

	// Optional auth resolver (rioku_mcp_auth) chained before the
	// reverse_proxy. The handler reads the API key + the JSON-RPC
	// body, calls the validator endpoint, and rejects with 403 when
	// the team's allow-list excludes the requested tool.
	if cfg.AuthValidatorEndpoint != "" {
		handlers = append(handlers, map[string]any{
			"handler":             "rioku_mcp_auth",
			"validator_endpoint":  cfg.AuthValidatorEndpoint,
			"mcp_server_id":       routeIDOrEmpty(cfg.ID),
		})
	}

	// Header transforms keyed off the auth-passthrough mode.
	headersBlock := map[string]any{}
	switch cfg.AuthPassthrough {
	case MCPAuthStrip:
		headersBlock["request"] = map[string]any{
			"delete": []string{"Authorization"},
		}
	case MCPAuthReplace:
		if cfg.UpstreamCredential != "" {
			headersBlock["request"] = map[string]any{
				"set": map[string]any{
					"Authorization": []string{"Bearer " + cfg.UpstreamCredential},
				},
			}
		}
	}
	if len(headersBlock) > 0 {
		handlers = append(handlers, map[string]any{
			"handler": "headers",
			"request": headersBlock["request"],
		})
	}

	// reverse_proxy upstream. Caddy's upstream config takes a host:port
	// dial address; for an https URL we rely on the transport's TLS
	// section to negotiate. For v1 we extract the dial target from the
	// URL — if the operator stored a path-bearing URL, the inbound
	// path concatenates after the prefix is rewritten.
	dial, scheme := dialAndScheme(cfg.UpstreamURL)
	rp := map[string]any{
		"handler": "reverse_proxy",
		"upstreams": []map[string]any{
			{"dial": dial},
		},
	}
	if scheme == "https" {
		rp["transport"] = map[string]any{
			"protocol": "http",
			"tls":      map[string]any{},
		}
	}
	handlers = append(handlers, rp)

	route := map[string]any{
		"handle": handlers,
	}
	if len(match) > 0 && len(match[0]) > 0 {
		route["match"] = match
	}
	return route
}

// dialAndScheme parses an upstream URL into (host:port, scheme).
// On any parse error returns (raw input, "") so the caller emits
// the literal value — Caddy will fail at provision time with a
// clear error. Defaults the port to 80/443 when unspecified.
func dialAndScheme(raw string) (string, string) {
	scheme := ""
	rest := raw
	if i := strings.Index(raw, "://"); i > 0 {
		scheme = raw[:i]
		rest = raw[i+3:]
	}
	// Strip path / query.
	if j := strings.IndexAny(rest, "/?#"); j > 0 {
		rest = rest[:j]
	}
	host := rest
	port := ""
	if k := strings.LastIndex(rest, ":"); k > 0 {
		host = rest[:k]
		port = rest[k+1:]
	}
	if port == "" {
		switch scheme {
		case "https":
			port = "443"
		default:
			port = "80"
		}
	}
	return host + ":" + port, scheme
}

func routeIDOrEmpty(s string) string { return s }

// buildOASValidatorHandler returns the JSON map for the
// rioku_oas_validator handler. Returns nil when the config is nil
// or when both OASURL and OASInline are empty (nothing to validate
// against — silently skip rather than fail-closed).
func buildOASValidatorHandler(cfg *RouteOASConfig) map[string]any {
	if cfg == nil {
		return nil
	}
	if cfg.OASURL == "" && cfg.OASInline == "" {
		return nil
	}
	h := map[string]any{
		"handler": "rioku_oas_validator",
	}
	if cfg.OASURL != "" {
		h["oas_url"] = cfg.OASURL
	}
	if cfg.OASInline != "" {
		h["oas_inline"] = cfg.OASInline
	}
	if cfg.RefreshIntervalSeconds > 0 {
		h["refresh_interval_seconds"] = cfg.RefreshIntervalSeconds
	}
	// The plugin defaults validate_request_body / validate_request_params
	// to true at Provision when both are false (operator omitted).
	// We forward the operator's stored values as-is so an explicit
	// false propagates correctly; both-false is also a valid stored
	// state (the plugin treats it as "use defaults"). This matches
	// the plugin's documented contract (validator.go: 128-141).
	h["validate_request_body"] = cfg.ValidateRequestBody
	h["validate_request_params"] = cfg.ValidateRequestParams
	if cfg.RejectUnknown {
		h["reject_unknown"] = true
	}
	return h
}

// buildWAFHandler returns the JSON map for the Coraza http.handlers.waf
// handler. Returns nil when cfg is nil or Enabled is false.
//
// The Coraza Caddy module exposes two JSON fields: directives (string,
// inline rules) and load_owasp_crs (bool). Per-route knobs are
// translated into directives:
//
//   - mode == "detect_only" -> SecRuleEngine DetectionOnly
//   - mode == "block"       -> SecRuleEngine On (default in Coraza)
//   - request_body_limit    -> SecRequestBodyLimit / SecRequestBodyAccess On
//   - paranoia_level        -> tx.paranoia_level via SecAction
//   - excluded_rule_ids     -> SecRuleRemoveById <id> per entry
func buildWAFHandler(cfg *RouteWAFConfig) map[string]any {
	if cfg == nil || !cfg.Enabled {
		return nil
	}

	var directives []string

	// Engine mode. Coraza defaults to "On" so we only emit when
	// detect-only is requested.
	if cfg.Mode == WAFModeDetectOnly {
		directives = append(directives, "SecRuleEngine DetectionOnly")
	} else {
		directives = append(directives, "SecRuleEngine On")
	}

	// Request body inspection. The OWASP CRS expects body access
	// to be on for the body-related rule classes; we always enable
	// it and apply the configured limit (default 128 KiB at the
	// store layer when the operator leaves it zero).
	directives = append(directives, "SecRequestBodyAccess On")
	if cfg.RequestBodyLimit > 0 {
		directives = append(directives,
			fmt.Sprintf("SecRequestBodyLimit %d", cfg.RequestBodyLimit),
			fmt.Sprintf("SecRequestBodyNoFilesLimit %d", cfg.RequestBodyLimit),
		)
	}

	// Paranoia level (CRS convention: tx.paranoia_level variable
	// drives which rules engage). Clamp to the documented 1-4
	// range; values outside are silently coerced rather than
	// failing the compile.
	pl := cfg.ParanoiaLevel
	if pl < 1 {
		pl = 1
	}
	if pl > 4 {
		pl = 4
	}
	directives = append(directives,
		fmt.Sprintf("SecAction \"id:900110,phase:1,nolog,pass,t:none,setvar:tx.paranoia_level=%d\"", pl),
	)

	// Excluded rule IDs. SecRuleRemoveById accepts space-separated
	// IDs but we emit one per line for grep-friendliness.
	for _, id := range cfg.ExcludedRuleIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		directives = append(directives, fmt.Sprintf("SecRuleRemoveById %s", id))
	}

	h := map[string]any{
		"handler":    "waf",
		"directives": strings.Join(directives, "\n"),
	}

	// "crs" is the only rule set this version ships with — flip the
	// dedicated load_owasp_crs flag so Coraza pulls in CRS at
	// provision time. When operators ship custom rule sets in the
	// future, the rule_set value will branch into different loaders
	// (e.g. inline directives, additional includes). CRS files are
	// NOT bundled into the binary (#172 v1 carve-out); they are
	// expected to be present on the Caddy host or fetched by the
	// Coraza module itself.
	if cfg.RuleSet == "" || cfg.RuleSet == "crs" {
		h["load_owasp_crs"] = true
	}

	return h
}
