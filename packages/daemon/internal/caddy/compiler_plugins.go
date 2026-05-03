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
}

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
