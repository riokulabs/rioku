package caddy

import (
	"encoding/json"
	"strings"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// baseSnapshot returns a minimal one-route snapshot used by per-route
// plugin tests so each test case only needs to assert the plugin
// handler shape.
func baseSnapshot() *riokuv1.ConfigSnapshot {
	return &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Name:    "api-route",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_Upstream{
					Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"},
				},
			},
		},
	}
}

// extractRouteHandlers returns the handler chain from the first route
// of the compiled traffic server, panicking if the JSON shape is
// unexpected (tests are expected to call this only on routes they
// just compiled).
func extractRouteHandlers(t *testing.T, data []byte) []map[string]any {
	t.Helper()
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal compiled config: %v", err)
	}
	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	if len(routes) == 0 {
		t.Fatalf("expected at least one route, got 0")
	}
	route := routes[0].(map[string]any)
	rawHandlers := route["handle"].([]any)
	out := make([]map[string]any, len(rawHandlers))
	for i, h := range rawHandlers {
		out[i] = h.(map[string]any)
	}
	return out
}

// indexOfHandler returns the index of the first handler with the
// given handler-name, or -1 if absent.
func indexOfHandler(handlers []map[string]any, name string) int {
	for i, h := range handlers {
		if n, _ := h["handler"].(string); n == name {
			return i
		}
	}
	return -1
}

// --------------------------------------------------------------------
// OAS validator (#171)
// --------------------------------------------------------------------

func TestCompileWithPlugins_OASValidator_URL(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		OASByRoute: map[string]*RouteOASConfig{
			"r1": {
				OASURL:                 "https://example.com/openapi.yaml",
				RefreshIntervalSeconds: 300,
				ValidateRequestBody:    true,
				ValidateRequestParams:  true,
				RejectUnknown:          true,
			},
		},
	}

	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}

	handlers := extractRouteHandlers(t, data)
	oas := findHandler(handlers, "rioku_oas_validator")
	if oas == nil {
		t.Fatalf("expected rioku_oas_validator handler in chain, got %+v", handlers)
	}

	if got := oas["oas_url"].(string); got != "https://example.com/openapi.yaml" {
		t.Errorf("oas_url = %q, want https://example.com/openapi.yaml", got)
	}
	if got := oas["refresh_interval_seconds"]; got != float64(300) {
		t.Errorf("refresh_interval_seconds = %v, want 300", got)
	}
	if got := oas["validate_request_body"].(bool); !got {
		t.Errorf("validate_request_body = false, want true")
	}
	if got := oas["validate_request_params"].(bool); !got {
		t.Errorf("validate_request_params = false, want true")
	}
	if got, _ := oas["reject_unknown"].(bool); !got {
		t.Errorf("reject_unknown = false, want true")
	}
	if _, hasInline := oas["oas_inline"]; hasInline {
		t.Errorf("oas_inline should be omitted when only oas_url is set")
	}
}

func TestCompileWithPlugins_OASValidator_Inline(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	const inlineSpec = "openapi: 3.0.0\ninfo:\n  title: tiny\n  version: 1\npaths: {}\n"
	perRoute := PerRoutePlugins{
		OASByRoute: map[string]*RouteOASConfig{
			"r1": {
				OASInline:             inlineSpec,
				ValidateRequestBody:   false,
				ValidateRequestParams: true,
			},
		},
	}

	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}

	handlers := extractRouteHandlers(t, data)
	oas := findHandler(handlers, "rioku_oas_validator")
	if oas == nil {
		t.Fatalf("expected rioku_oas_validator handler in chain")
	}
	if got := oas["oas_inline"].(string); got != inlineSpec {
		t.Errorf("oas_inline = %q, want %q", got, inlineSpec)
	}
	if _, hasURL := oas["oas_url"]; hasURL {
		t.Errorf("oas_url should be omitted when only oas_inline is set")
	}
	if got := oas["validate_request_body"].(bool); got {
		t.Errorf("validate_request_body = true, want false (operator override)")
	}
	if _, has := oas["reject_unknown"]; has {
		t.Errorf("reject_unknown should be omitted when false (operator default)")
	}
}

func TestCompileWithPlugins_OASValidator_EmptyConfigSkipped(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	// Both OASURL and OASInline empty: a stale row in the table that
	// should be silently skipped rather than fail-closed.
	perRoute := PerRoutePlugins{
		OASByRoute: map[string]*RouteOASConfig{
			"r1": {ValidateRequestBody: true},
		},
	}

	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}
	handlers := extractRouteHandlers(t, data)
	if findHandler(handlers, "rioku_oas_validator") != nil {
		t.Errorf("expected no rioku_oas_validator handler when OAS URL/inline are empty")
	}
}

func TestCompileWithPlugins_OASValidator_NotConfiguredSkipped(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	// Empty per-route maps: bare Compile output should match.
	data, err := c.CompileWithPlugins(baseSnapshot(), PerRoutePlugins{})
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}
	handlers := extractRouteHandlers(t, data)
	if findHandler(handlers, "rioku_oas_validator") != nil {
		t.Errorf("expected no rioku_oas_validator handler when no OAS config is supplied")
	}
}

// --------------------------------------------------------------------
// WAF (#172)
// --------------------------------------------------------------------

func TestCompileWithPlugins_WAF_BlockMode(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		WAFByRoute: map[string]*RouteWAFConfig{
			"r1": {
				Enabled:          true,
				Mode:             WAFModeBlock,
				RuleSet:          "crs",
				ParanoiaLevel:    2,
				ExcludedRuleIDs:  []string{"941100", "941110"},
				RequestBodyLimit: 65536,
			},
		},
	}

	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}

	handlers := extractRouteHandlers(t, data)
	waf := findHandler(handlers, "waf")
	if waf == nil {
		t.Fatalf("expected coraza waf handler in chain, got %+v", handlers)
	}

	if got := waf["load_owasp_crs"]; got != true {
		t.Errorf("load_owasp_crs = %v, want true", got)
	}

	directives, _ := waf["directives"].(string)
	if directives == "" {
		t.Fatalf("directives string is empty")
	}

	wantSubstrings := []string{
		"SecRuleEngine On",
		"SecRequestBodyAccess On",
		"SecRequestBodyLimit 65536",
		"setvar:tx.paranoia_level=2",
		"SecRuleRemoveById 941100",
		"SecRuleRemoveById 941110",
	}
	for _, want := range wantSubstrings {
		if !strings.Contains(directives, want) {
			t.Errorf("directives missing %q\nfull directives:\n%s", want, directives)
		}
	}
	if strings.Contains(directives, "DetectionOnly") {
		t.Errorf("block mode emitted DetectionOnly directive: %s", directives)
	}
}

func TestCompileWithPlugins_WAF_DetectOnlyMode(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		WAFByRoute: map[string]*RouteWAFConfig{
			"r1": {
				Enabled:       true,
				Mode:          WAFModeDetectOnly,
				RuleSet:       "crs",
				ParanoiaLevel: 1,
			},
		},
	}

	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}
	handlers := extractRouteHandlers(t, data)
	waf := findHandler(handlers, "waf")
	if waf == nil {
		t.Fatalf("expected waf handler in chain")
	}
	directives := waf["directives"].(string)
	if !strings.Contains(directives, "SecRuleEngine DetectionOnly") {
		t.Errorf("expected DetectionOnly directive, got %s", directives)
	}
}

func TestCompileWithPlugins_WAF_DisabledSkipped(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		WAFByRoute: map[string]*RouteWAFConfig{
			"r1": {Enabled: false, Mode: WAFModeBlock, RuleSet: "crs"},
		},
	}
	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}
	handlers := extractRouteHandlers(t, data)
	if findHandler(handlers, "waf") != nil {
		t.Errorf("expected no waf handler when Enabled is false")
	}
}

func TestCompileWithPlugins_WAF_ParanoiaClamped(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	for _, tc := range []struct {
		name string
		in   int32
		want string
	}{
		{name: "below_floor", in: 0, want: "tx.paranoia_level=1"},
		{name: "negative", in: -3, want: "tx.paranoia_level=1"},
		{name: "above_ceiling", in: 99, want: "tx.paranoia_level=4"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			perRoute := PerRoutePlugins{
				WAFByRoute: map[string]*RouteWAFConfig{
					"r1": {Enabled: true, Mode: WAFModeBlock, RuleSet: "crs", ParanoiaLevel: tc.in},
				},
			}
			data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
			if err != nil {
				t.Fatalf("CompileWithPlugins: %v", err)
			}
			handlers := extractRouteHandlers(t, data)
			waf := findHandler(handlers, "waf")
			if waf == nil {
				t.Fatalf("expected waf handler")
			}
			d := waf["directives"].(string)
			if !strings.Contains(d, tc.want) {
				t.Errorf("directives missing %q in %s", tc.want, d)
			}
		})
	}
}

func TestCompileWithPlugins_WAF_NonCRSRuleSet(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		WAFByRoute: map[string]*RouteWAFConfig{
			"r1": {Enabled: true, Mode: WAFModeBlock, RuleSet: "custom-only", ParanoiaLevel: 1},
		},
	}
	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}
	handlers := extractRouteHandlers(t, data)
	waf := findHandler(handlers, "waf")
	if waf == nil {
		t.Fatalf("expected waf handler")
	}
	if _, has := waf["load_owasp_crs"]; has {
		t.Errorf("load_owasp_crs should be omitted for non-crs rule set, got %+v", waf)
	}
}

// --------------------------------------------------------------------
// Ordering & coexistence
// --------------------------------------------------------------------

func TestCompileWithPlugins_HandlerOrdering(t *testing.T) {
	// Both WAF and OAS configured: WAF must precede OAS, both must
	// precede the reverse_proxy, and tracing/vars must remain at the
	// front of the chain.
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		OASByRoute: map[string]*RouteOASConfig{
			"r1": {OASURL: "https://example.com/openapi.yaml", ValidateRequestBody: true, ValidateRequestParams: true},
		},
		WAFByRoute: map[string]*RouteWAFConfig{
			"r1": {Enabled: true, Mode: WAFModeBlock, RuleSet: "crs", ParanoiaLevel: 1},
		},
	}
	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}
	handlers := extractRouteHandlers(t, data)

	tracingIdx := indexOfHandler(handlers, "tracing")
	varsIdx := indexOfHandler(handlers, "vars")
	wafIdx := indexOfHandler(handlers, "waf")
	oasIdx := indexOfHandler(handlers, "rioku_oas_validator")
	rpIdx := indexOfHandler(handlers, "reverse_proxy")

	if tracingIdx != 0 {
		t.Errorf("tracing handler index = %d, want 0", tracingIdx)
	}
	if tracingIdx >= varsIdx || varsIdx >= wafIdx || wafIdx >= oasIdx || oasIdx >= rpIdx {
		t.Errorf("unexpected handler order: tracing=%d vars=%d waf=%d oas=%d rp=%d", tracingIdx, varsIdx, wafIdx, oasIdx, rpIdx)
	}
}

func TestCompile_BareCallEquivalentToEmptyPlugins(t *testing.T) {
	// Compile and CompileWithPlugins(snapshot, PerRoutePlugins{})
	// must produce byte-identical output so the legacy Compile path
	// keeps working unchanged for callers that have not yet adopted
	// the per-route plugin maps.
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	snap := baseSnapshot()

	bareData, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	withData, err := c.CompileWithPlugins(snap, PerRoutePlugins{})
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}
	if string(bareData) != string(withData) {
		t.Errorf("bare Compile and empty-plugin CompileWithPlugins produced different output:\n bare: %s\n with: %s", bareData, withData)
	}
}

// TestCompileWithPlugins_WAF_AuditEndpointEmitted verifies the compiler
// appends the SecAudit* directives (and the SecAuditLog target URL)
// when the daemon supplies a /waf-record endpoint via
// SetWAFAuditEndpoint. Without those directives the data plane never
// reports denials and /api/v1/waf/denials stays empty (#203 follow-up).
func TestCompileWithPlugins_WAF_AuditEndpointEmitted(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	c.SetWAFAuditEndpoint("http://127.0.0.1:7791/waf-record")

	perRoute := PerRoutePlugins{
		WAFByRoute: map[string]*RouteWAFConfig{
			"r1": {
				Enabled:       true,
				Mode:          WAFModeBlock,
				RuleSet:       "crs",
				ParanoiaLevel: 2,
			},
		},
	}
	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}
	handlers := extractRouteHandlers(t, data)
	waf := findHandler(handlers, "waf")
	if waf == nil {
		t.Fatalf("expected waf handler in chain")
	}
	directives := waf["directives"].(string)
	for _, want := range []string{
		"SecAuditEngine RelevantOnly",
		"SecAuditLogType https",
		"SecAuditLogFormat json",
		"SecAuditLog http://127.0.0.1:7791/waf-record",
	} {
		if !strings.Contains(directives, want) {
			t.Errorf("directives missing %q\nfull:\n%s", want, directives)
		}
	}
}

// TestCompileWithPlugins_WAF_NoAuditEndpointNoDirectives verifies the
// compiler does NOT emit SecAudit* directives when the endpoint is
// empty. Hosts running in dev mode without a key-validator address
// shouldn't get spurious "no such host" errors from Coraza trying to
// POST audit logs.
func TestCompileWithPlugins_WAF_NoAuditEndpointNoDirectives(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	// no SetWAFAuditEndpoint call

	perRoute := PerRoutePlugins{
		WAFByRoute: map[string]*RouteWAFConfig{
			"r1": {Enabled: true, Mode: WAFModeBlock, RuleSet: "crs", ParanoiaLevel: 1},
		},
	}
	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}
	handlers := extractRouteHandlers(t, data)
	waf := findHandler(handlers, "waf")
	if waf == nil {
		t.Fatalf("expected waf handler")
	}
	directives := waf["directives"].(string)
	if strings.Contains(directives, "SecAuditLog") {
		t.Errorf("SecAuditLog directive emitted without endpoint:\n%s", directives)
	}
}
