package caddy

import (
	"encoding/json"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

func TestCompileSimpleRoute(t *testing.T) {
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Name:    "api-route",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{
						Hosts: []string{"api.example.com"},
						Paths: []*riokuv1.PathMatcher{
							{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/v1"},
						},
					},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:       "svc1",
				Name:     "backend",
				LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				Upstreams: []*riokuv1.Upstream{
					{Id: "u1", Address: "10.0.0.1:8080"},
					{Id: "u2", Address: "10.0.0.2:8080"},
				},
				HealthCheck: &riokuv1.HealthCheck{
					Enabled:         true,
					Path:            "/health",
					IntervalSeconds: 10,
					TimeoutSeconds:  5,
				},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}

	// Navigate to the route.
	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	listen := server["listen"].([]any)
	if len(listen) != 2 {
		t.Fatalf("expected 2 listen addrs, got %d", len(listen))
	}

	routes := server["routes"].([]any)
	if len(routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(routes))
	}

	route := routes[0].(map[string]any)

	// Check match.
	matchSets := route["match"].([]any)
	if len(matchSets) != 1 {
		t.Fatalf("expected 1 match set, got %d", len(matchSets))
	}
	ms := matchSets[0].(map[string]any)
	hosts := ms["host"].([]any)
	if hosts[0].(string) != "api.example.com" {
		t.Errorf("host = %v, want api.example.com", hosts[0])
	}
	paths := ms["path"].([]any)
	if paths[0].(string) != "/v1/*" {
		t.Errorf("path = %v, want /v1/*", paths[0])
	}

	// Check handlers (tracing + rioku_vars + reverse_proxy).
	handlers := route["handle"].([]any)
	if len(handlers) != 3 {
		t.Fatalf("expected 3 handlers, got %d", len(handlers))
	}
	tracing := handlers[0].(map[string]any)
	if tracing["handler"].(string) != "tracing" {
		t.Errorf("handlers[0] = %v, want tracing", tracing["handler"])
	}
	vars := handlers[1].(map[string]any)
	if vars["handler"].(string) != "vars" {
		t.Errorf("handlers[1] = %v, want vars", vars["handler"])
	}
	h := handlers[2].(map[string]any)
	if h["handler"].(string) != "reverse_proxy" {
		t.Errorf("handler = %v, want reverse_proxy", h["handler"])
	}

	upstreams := h["upstreams"].([]any)
	if len(upstreams) != 2 {
		t.Fatalf("expected 2 upstreams, got %d", len(upstreams))
	}
	if upstreams[0].(map[string]any)["dial"].(string) != "10.0.0.1:8080" {
		t.Errorf("upstream[0].dial = %v", upstreams[0])
	}

	// Check load balancing.
	lb := h["load_balancing"].(map[string]any)
	sp := lb["selection_policy"].(map[string]any)
	if sp["policy"].(string) != "round_robin" {
		t.Errorf("lb policy = %v, want round_robin", sp["policy"])
	}

	// Check health checks.
	hcs := h["health_checks"].(map[string]any)
	active := hcs["active"].(map[string]any)
	if active["path"].(string) != "/health" {
		t.Errorf("health check path = %v", active["path"])
	}
	if active["interval"].(string) != "10s" {
		t.Errorf("health check interval = %v", active["interval"])
	}
	if active["timeout"].(string) != "5s" {
		t.Errorf("health check timeout = %v", active["timeout"])
	}
}

func TestCompileMultipleRoutes(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
			{
				Id:      "r2",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"web.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc2"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:        "svc1",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			},
			{
				Id:        "svc2",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.2:9090"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	if len(routes) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(routes))
	}

	// Verify each route has different hosts.
	r1 := routes[0].(map[string]any)
	r2 := routes[1].(map[string]any)
	h1 := r1["match"].([]any)[0].(map[string]any)["host"].([]any)[0].(string)
	h2 := r2["match"].([]any)[0].(map[string]any)["host"].([]any)[0].(string)
	if h1 == h2 {
		t.Errorf("both routes have same host %q", h1)
	}
}

func TestCompileDisabledRouteExcluded(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"enabled.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
			{
				Id:      "r2",
				Enabled: false, // disabled
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"disabled.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:        "svc1",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	if len(routes) != 1 {
		t.Fatalf("expected 1 route (disabled excluded), got %d", len(routes))
	}

	host := routes[0].(map[string]any)["match"].([]any)[0].(map[string]any)["host"].([]any)[0].(string)
	if host != "enabled.example.com" {
		t.Errorf("expected enabled.example.com, got %v", host)
	}
}

func TestCompileDirectUpstream(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"direct.example.com"}},
				},
				Target: &riokuv1.Route_Upstream{
					Upstream: &riokuv1.DirectUpstream{
						Address: "192.168.1.1:3000",
					},
				},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	if len(routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(routes))
	}

	handleChain := routes[0].(map[string]any)["handle"].([]any)
	if len(handleChain) != 3 {
		t.Fatalf("expected 3 handlers, got %d", len(handleChain))
	}
	if handleChain[0].(map[string]any)["handler"].(string) != "tracing" {
		t.Errorf("handlers[0] = %v, want tracing", handleChain[0].(map[string]any)["handler"])
	}
	if handleChain[1].(map[string]any)["handler"].(string) != "vars" {
		t.Errorf("handlers[1] = %v, want vars", handleChain[1].(map[string]any)["handler"])
	}
	handler := handleChain[2].(map[string]any)
	if handler["handler"].(string) != "reverse_proxy" {
		t.Errorf("handler = %v, want reverse_proxy", handler["handler"])
	}

	upstreams := handler["upstreams"].([]any)
	if len(upstreams) != 1 {
		t.Fatalf("expected 1 upstream, got %d", len(upstreams))
	}
	dial := upstreams[0].(map[string]any)["dial"].(string)
	if dial != "192.168.1.1:3000" {
		t.Errorf("dial = %v, want 192.168.1.1:3000", dial)
	}

	// Direct upstream should not have load_balancing or health_checks.
	if _, ok := handler["load_balancing"]; ok {
		t.Error("direct upstream should not have load_balancing")
	}
	if _, ok := handler["health_checks"]; ok {
		t.Error("direct upstream should not have health_checks")
	}
}

func TestCompileEmptyConfig(t *testing.T) {
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	if len(routes) != 0 {
		t.Fatalf("expected 0 routes, got %d", len(routes))
	}
}

func TestMatcherTypes(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	tests := []struct {
		name    string
		matcher *riokuv1.Matcher
		check   func(t *testing.T, ms map[string]any)
	}{
		{
			name:    "host matcher",
			matcher: &riokuv1.Matcher{Hosts: []string{"a.com", "b.com"}},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				hosts := ms["host"].([]any)
				if len(hosts) != 2 {
					t.Fatalf("expected 2 hosts, got %d", len(hosts))
				}
				if hosts[0].(string) != "a.com" || hosts[1].(string) != "b.com" {
					t.Errorf("hosts = %v", hosts)
				}
			},
		},
		{
			name: "path prefix matcher",
			matcher: &riokuv1.Matcher{
				Paths: []*riokuv1.PathMatcher{
					{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/api"},
				},
			},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				paths := ms["path"].([]any)
				if len(paths) != 1 || paths[0].(string) != "/api/*" {
					t.Errorf("path = %v, want [\"/api/*\"]", paths)
				}
			},
		},
		{
			name: "path exact matcher",
			matcher: &riokuv1.Matcher{
				Paths: []*riokuv1.PathMatcher{
					{Type: riokuv1.PathMatcher_TYPE_EXACT, Value: "/health"},
				},
			},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				paths := ms["path"].([]any)
				if len(paths) != 1 || paths[0].(string) != "/health" {
					t.Errorf("path = %v, want [\"/health\"]", paths)
				}
			},
		},
		{
			name: "path regexp matcher",
			matcher: &riokuv1.Matcher{
				Paths: []*riokuv1.PathMatcher{
					{Type: riokuv1.PathMatcher_TYPE_REGEXP, Value: "^/v[0-9]+/.*$"},
				},
			},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				if _, ok := ms["path"]; ok {
					t.Error("regexp should not set path key")
				}
				pr := ms["path_regexp"].(map[string]any)
				if pr["pattern"].(string) != "^/v[0-9]+/.*$" {
					t.Errorf("pattern = %v", pr["pattern"])
				}
			},
		},
		{
			name:    "method matcher",
			matcher: &riokuv1.Matcher{Methods: []string{"GET", "POST"}},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				methods := ms["method"].([]any)
				if len(methods) != 2 {
					t.Fatalf("expected 2 methods, got %d", len(methods))
				}
				if methods[0].(string) != "GET" || methods[1].(string) != "POST" {
					t.Errorf("methods = %v", methods)
				}
			},
		},
		{
			name: "header matcher",
			matcher: &riokuv1.Matcher{
				Headers: []*riokuv1.HeaderMatcher{
					{Name: "X-Custom", Value: "hello"},
				},
			},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				headers := ms["header"].(map[string]any)
				vals := headers["X-Custom"].([]any)
				if len(vals) != 1 || vals[0].(string) != "hello" {
					t.Errorf("header X-Custom = %v", vals)
				}
			},
		},
		{
			name: "header matcher inverted",
			matcher: &riokuv1.Matcher{
				Headers: []*riokuv1.HeaderMatcher{
					{Name: "X-Block", Value: "bad", Invert: true},
				},
			},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				headers := ms["header"].(map[string]any)
				vals := headers["X-Block"].([]any)
				if len(vals) != 1 || vals[0].(string) != "!bad" {
					t.Errorf("header X-Block = %v, want [\"!bad\"]", vals)
				}
			},
		},
		{
			name: "header regexp matcher (#72)",
			matcher: &riokuv1.Matcher{
				Headers: []*riokuv1.HeaderMatcher{
					{Name: "X-Trace", Value: "^abc[0-9]+$", Regexp: true},
				},
			},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				if _, ok := ms["header"]; ok {
					t.Error("regexp header should not appear under `header` key")
				}
				hr := ms["header_regexp"].(map[string]any)
				entry := hr["X-Trace"].(map[string]any)
				if entry["pattern"].(string) != "^abc[0-9]+$" {
					t.Errorf("X-Trace pattern = %v", entry["pattern"])
				}
			},
		},
		{
			name: "query matcher (#72)",
			matcher: &riokuv1.Matcher{
				Queries: []*riokuv1.QueryMatcher{
					{Key: "version", Value: "v1"},
					{Key: "version", Value: "v2"},
					{Key: "debug", Value: ""},
				},
			},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				q := ms["query"].(map[string]any)
				versions := q["version"].([]any)
				if len(versions) != 2 || versions[0].(string) != "v1" || versions[1].(string) != "v2" {
					t.Errorf("query version = %v, want [v1 v2]", versions)
				}
				dbg := q["debug"].([]any)
				if len(dbg) != 1 || dbg[0].(string) != "" {
					t.Errorf("query debug = %v, want [\"\"] (existence-only)", dbg)
				}
			},
		},
		{
			name: "expression matcher (#72)",
			matcher: &riokuv1.Matcher{
				Expression: `header({'Host': 'example.com'}) && method('GET')`,
			},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				expr := ms["expression"].(string)
				if expr != `header({'Host': 'example.com'}) && method('GET')` {
					t.Errorf("expression = %q", expr)
				}
			},
		},
		{
			name: "not matcher (#72)",
			matcher: &riokuv1.Matcher{
				Hosts: []string{"api.example.com"},
				Not: []*riokuv1.Matcher{
					{Paths: []*riokuv1.PathMatcher{
						{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/internal"},
					}},
				},
			},
			check: func(t *testing.T, ms map[string]any) {
				t.Helper()
				if hosts := ms["host"].([]any); len(hosts) != 1 || hosts[0].(string) != "api.example.com" {
					t.Errorf("host = %v", hosts)
				}
				notSets := ms["not"].([]any)
				if len(notSets) != 1 {
					t.Fatalf("expected 1 not-set, got %d", len(notSets))
				}
				inner := notSets[0].(map[string]any)
				paths := inner["path"].([]any)
				if len(paths) != 1 || paths[0].(string) != "/internal/*" {
					t.Errorf("not.path = %v", paths)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			snapshot := &riokuv1.ConfigSnapshot{
				Routes: []*riokuv1.Route{
					{
						Id:       "r1",
						Enabled:  true,
						Matchers: []*riokuv1.Matcher{tt.matcher},
						Target: &riokuv1.Route_Upstream{
							Upstream: &riokuv1.DirectUpstream{Address: "127.0.0.1:8080"},
						},
					},
				},
			}

			data, err := c.Compile(snapshot)
			if err != nil {
				t.Fatalf("Compile: %v", err)
			}

			var cfg map[string]any
			if err := json.Unmarshal(data, &cfg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}

			server := dig(t, cfg, "apps", "http", "servers", "traffic")
			routes := server["routes"].([]any)
			route := routes[0].(map[string]any)
			matchSets := route["match"].([]any)
			ms := matchSets[0].(map[string]any)

			tt.check(t, ms)
		})
	}
}

func TestCompileServiceNotFound(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target:  &riokuv1.Route_ServiceId{ServiceId: "missing"},
			},
		},
	}

	_, err := c.Compile(snapshot)
	if err == nil {
		t.Fatal("expected error for missing service, got nil")
	}
}

func TestCompileWeightedRoundRobin(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target:  &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:       "svc1",
				LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_WEIGHTED_ROUND_ROBIN,
				Upstreams: []*riokuv1.Upstream{
					{Address: "10.0.0.1:8080", Weight: 3},
					{Address: "10.0.0.2:8080", Weight: 1},
				},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any) // [0]=tracing, [1]=vars
	lb := handler["load_balancing"].(map[string]any)
	sp := lb["selection_policy"].(map[string]any)

	if sp["policy"].(string) != "weighted_round_robin" {
		t.Errorf("policy = %v, want weighted_round_robin", sp["policy"])
	}

	weights := sp["weights"].([]any)
	if len(weights) != 2 {
		t.Fatalf("expected 2 weights, got %d", len(weights))
	}
	// JSON numbers unmarshal to float64.
	if weights[0].(float64) != 3 || weights[1].(float64) != 1 {
		t.Errorf("weights = %v, want [3, 1]", weights)
	}
}

// digSelectionPolicy compiles a service with the given LB policy and
// extracts the selection_policy map from the resulting reverse_proxy
// handler. Used by the new session-affinity / hash LB tests below.
func digSelectionPolicy(t *testing.T, svc *riokuv1.Service) map[string]any {
	t.Helper()
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target:  &riokuv1.Route_ServiceId{ServiceId: svc.GetId()},
			},
		},
		Services: []*riokuv1.Service{svc},
	}
	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any)
	lb := handler["load_balancing"].(map[string]any)
	return lb["selection_policy"].(map[string]any)
}

// TestCompile_CookieLBPolicy verifies #71's cookie selection policy
// with a custom cookie name.
func TestCompile_CookieLBPolicy(t *testing.T) {
	sp := digSelectionPolicy(t, &riokuv1.Service{
		Id:           "svc1",
		LbPolicy:     riokuv1.LoadBalancingPolicy_LB_POLICY_COOKIE,
		LbCookieName: "rioku_sticky",
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080"},
			{Address: "10.0.0.2:8080"},
		},
	})
	if sp["policy"] != "cookie" {
		t.Errorf("policy = %v, want cookie", sp["policy"])
	}
	if sp["name"] != "rioku_sticky" {
		t.Errorf("name = %v, want rioku_sticky", sp["name"])
	}
}

// TestCompile_CookieLBPolicy_DefaultName verifies that an empty
// LbCookieName omits the `name` field so Caddy applies its built-in
// default ("lb").
func TestCompile_CookieLBPolicy_DefaultName(t *testing.T) {
	sp := digSelectionPolicy(t, &riokuv1.Service{
		Id:       "svc1",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_COOKIE,
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080"},
		},
	})
	if sp["policy"] != "cookie" {
		t.Errorf("policy = %v, want cookie", sp["policy"])
	}
	if _, ok := sp["name"]; ok {
		t.Errorf("name should be omitted when LbCookieName empty, got %v", sp["name"])
	}
}

// TestCompile_URIHashLBPolicy verifies #71's uri_hash selection
// policy.
func TestCompile_URIHashLBPolicy(t *testing.T) {
	sp := digSelectionPolicy(t, &riokuv1.Service{
		Id:       "svc1",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_URI_HASH,
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080"},
		},
	})
	if sp["policy"] != "uri_hash" {
		t.Errorf("policy = %v, want uri_hash", sp["policy"])
	}
}

// TestCompile_HeaderLBPolicy verifies #71's header selection policy
// with the required field.
func TestCompile_HeaderLBPolicy(t *testing.T) {
	sp := digSelectionPolicy(t, &riokuv1.Service{
		Id:           "svc1",
		LbPolicy:     riokuv1.LoadBalancingPolicy_LB_POLICY_HEADER,
		LbHeaderName: "X-Customer-ID",
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080"},
		},
	})
	if sp["policy"] != "header" {
		t.Errorf("policy = %v, want header", sp["policy"])
	}
	if sp["field"] != "X-Customer-ID" {
		t.Errorf("field = %v, want X-Customer-ID", sp["field"])
	}
}

func TestCompileTwoServerBlocks(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{
		InternalAddr: "127.0.0.1:54321",
		ListenAddr:   ":7778",
	}, "", nil, SecurityHeadersConfig{})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	servers := dig(t, cfg, "apps", "http", "servers")

	// traffic block
	traffic := servers["traffic"].(map[string]any)
	tListen := traffic["listen"].([]any)
	if len(tListen) != 1 || tListen[0].(string) != ":443" {
		t.Errorf("traffic listen = %v, want [:443]", tListen)
	}

	// admin block
	admin, ok := servers["admin"].(map[string]any)
	if !ok {
		t.Fatal("admin server block missing")
	}
	aListen := admin["listen"].([]any)
	if len(aListen) != 1 || aListen[0].(string) != ":7778" {
		t.Errorf("admin listen = %v, want [:7778]", aListen)
	}

	routes := admin["routes"].([]any)
	if len(routes) != 1 {
		t.Fatalf("admin routes: expected 1, got %d", len(routes))
	}
	h := routes[0].(map[string]any)["handle"].([]any)[0].(map[string]any)
	if h["handler"].(string) != "reverse_proxy" {
		t.Errorf("admin handler = %v, want reverse_proxy", h["handler"])
	}
	upstreams := h["upstreams"].([]any)
	if upstreams[0].(map[string]any)["dial"].(string) != "127.0.0.1:54321" {
		t.Errorf("admin upstream dial = %v, want 127.0.0.1:54321", upstreams[0])
	}
}

func TestCompileAdminDomain(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{
		InternalAddr: "127.0.0.1:54321",
		Domain:       "admin.example.com",
	}, "", nil, SecurityHeadersConfig{})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	servers := dig(t, cfg, "apps", "http", "servers")
	admin := servers["admin"].(map[string]any)

	aListen := admin["listen"].([]any)
	if aListen[0].(string) != ":443" {
		t.Errorf("admin domain listen = %v, want :443", aListen)
	}

	route := admin["routes"].([]any)[0].(map[string]any)
	match := route["match"].([]any)[0].(map[string]any)
	hosts := match["host"].([]any)
	if hosts[0].(string) != "admin.example.com" {
		t.Errorf("admin domain host = %v, want admin.example.com", hosts[0])
	}

	if _, ok := admin["tls_connection_policies"]; !ok {
		t.Error("admin domain block missing tls_connection_policies")
	}
}

func TestCompileAdminDevMode(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{
		InternalAddr: "127.0.0.1:54321",
		Domain:       "admin.example.com",
		DevMode:      true,
	}, "", nil, SecurityHeadersConfig{})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	servers := dig(t, cfg, "apps", "http", "servers")
	admin := servers["admin"].(map[string]any)

	if _, ok := admin["tls_connection_policies"]; ok {
		t.Error("dev mode admin block should not have tls_connection_policies")
	}
}

func TestCompileNoAdminBlock(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	servers := dig(t, cfg, "apps", "http", "servers")
	if _, ok := servers["admin"]; ok {
		t.Error("expected no admin block when InternalAddr is empty")
	}
	if _, ok := servers["traffic"]; !ok {
		t.Error("expected traffic block to exist")
	}
}

func TestCompile_InjectsRiokuVars(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "route-1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc-1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:        "svc-1",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	if len(routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(routes))
	}

	handlers := routes[0].(map[string]any)["handle"].([]any)
	if len(handlers) != 3 {
		t.Fatalf("expected 3 handlers (tracing + rioku_vars + reverse_proxy), got %d", len(handlers))
	}

	// First handler: tracing.
	tracing := handlers[0].(map[string]any)
	if tracing["handler"].(string) != "tracing" {
		t.Errorf("handlers[0].handler = %v, want tracing", tracing["handler"])
	}

	// Second handler: rioku_vars with route_id and service_id.
	vars := handlers[1].(map[string]any)
	if vars["handler"].(string) != "vars" {
		t.Errorf("handlers[1].handler = %v, want vars", vars["handler"])
	}
	if vars["rioku_route_id"].(string) != "route-1" {
		t.Errorf("handlers[1].rioku_route_id = %v, want route-1", vars["rioku_route_id"])
	}
	if vars["rioku_service_id"].(string) != "svc-1" {
		t.Errorf("handlers[1].rioku_service_id = %v, want svc-1", vars["rioku_service_id"])
	}

	// Third handler: reverse_proxy.
	proxy := handlers[2].(map[string]any)
	if proxy["handler"].(string) != "reverse_proxy" {
		t.Errorf("handlers[2].handler = %v, want reverse_proxy", proxy["handler"])
	}
}

func TestCompile_InjectsRiokuVars_DirectUpstream(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "route-2",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"direct.example.com"}},
				},
				Target: &riokuv1.Route_Upstream{
					Upstream: &riokuv1.DirectUpstream{Address: "192.168.1.1:3000"},
				},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	handlers := routes[0].(map[string]any)["handle"].([]any)

	vars := handlers[1].(map[string]any)
	if vars["handler"].(string) != "vars" {
		t.Errorf("handlers[1].handler = %v, want vars", vars["handler"])
	}
	if vars["rioku_route_id"].(string) != "route-2" {
		t.Errorf("handlers[1].rioku_route_id = %v, want route-2", vars["rioku_route_id"])
	}
	// Direct upstream routes should have empty service_id.
	if vars["rioku_service_id"].(string) != "" {
		t.Errorf("handlers[1].rioku_service_id = %v, want empty string", vars["rioku_service_id"])
	}
}

func TestCompile_ConfiguresTraceLogger(t *testing.T) {
	socketPath := "/tmp/rioku-trace.sock"
	c := NewCompiler([]string{":443"}, AdminConfig{}, socketPath, nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc-1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:        "svc-1",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Verify traffic server has access log config.
	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	logs, ok := server["logs"].(map[string]any)
	if !ok {
		t.Fatal("traffic server missing logs config")
	}
	if logs["default_logger_name"].(string) != "rioku" {
		t.Errorf("default_logger_name = %v, want rioku", logs["default_logger_name"])
	}

	// Verify top-level logging block.
	logging := dig(t, cfg, "logging", "logs", "rioku_trace")

	writer := logging["writer"].(map[string]any)
	if writer["output"].(string) != "net" {
		t.Errorf("writer.output = %v, want net", writer["output"])
	}
	expectedAddr := "unix/" + socketPath
	if writer["address"].(string) != expectedAddr {
		t.Errorf("writer.address = %v, want %v", writer["address"], expectedAddr)
	}

	// PR4 wraps the original json encoder with a "filter" encoder that
	// renames the trace-id header into a flat "request_id" field, so the
	// outermost encoder.format is now "filter" with the json encoder
	// nested under .wrap.
	encoder := logging["encoder"].(map[string]any)
	if encoder["format"].(string) != "filter" {
		t.Errorf("encoder.format = %v, want filter", encoder["format"])
	}
	wrap, ok := encoder["wrap"].(map[string]any)
	if !ok {
		t.Fatalf("encoder.wrap missing")
	}
	if wrap["format"].(string) != "json" {
		t.Errorf("encoder.wrap.format = %v, want json", wrap["format"])
	}

	include := logging["include"].([]any)
	if len(include) != 1 || include[0].(string) != "http.log.access.rioku" {
		t.Errorf("include = %v, want [http.log.access.rioku]", include)
	}
}

func TestCompile_NoTraceLoggerWhenPathEmpty(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if _, ok := cfg["logging"]; ok {
		t.Error("expected no logging block when traceSocketPath is empty")
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	if _, ok := server["logs"]; ok {
		t.Error("expected no logs config on traffic server when traceSocketPath is empty")
	}
}

func TestCompile_TrustedProxies(t *testing.T) {
	tp := &TrustedProxiesConfig{Ranges: []string{"10.0.0.0/8"}}
	c := NewCompiler([]string{":443"}, AdminConfig{
		InternalAddr: "127.0.0.1:54321",
		ListenAddr:   ":7778",
	}, "", tp, SecurityHeadersConfig{})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	servers := dig(t, cfg, "apps", "http", "servers")

	for _, name := range []string{"traffic", "admin"} {
		srv := servers[name].(map[string]any)
		tp, ok := srv["trusted_proxies"].(map[string]any)
		if !ok {
			t.Fatalf("server %q missing trusted_proxies", name)
		}
		if tp["source"].(string) != "static" {
			t.Errorf("server %q trusted_proxies.source = %v, want static", name, tp["source"])
		}
		ranges := tp["ranges"].([]any)
		if len(ranges) != 1 || ranges[0].(string) != "10.0.0.0/8" {
			t.Errorf("server %q trusted_proxies.ranges = %v, want [10.0.0.0/8]", name, ranges)
		}
	}
}

func TestCompile_TrustedProxies_Empty(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	if _, ok := server["trusted_proxies"]; ok {
		t.Error("expected no trusted_proxies when config is nil")
	}
}

func TestCompile_MetricsEnabled(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{
		InternalAddr: "127.0.0.1:54321",
		ListenAddr:   ":7778",
	}, "", nil, SecurityHeadersConfig{})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Metrics must be at the root http app level, not per-server.
	httpApp := dig(t, cfg, "apps", "http")
	m, ok := httpApp["metrics"]
	if !ok {
		t.Fatal("http app missing metrics key")
	}
	metrics, ok := m.(map[string]any)
	if !ok {
		t.Fatalf("metrics is %T, want map", m)
	}
	if len(metrics) != 0 {
		t.Errorf("metrics = %v, want empty map", metrics)
	}
}

func TestCompile_FlushInterval(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
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

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	route := routes[0].(map[string]any)
	handlers := route["handle"].([]any)

	// Find the reverse_proxy handler (last in chain).
	proxy := handlers[len(handlers)-1].(map[string]any)
	if proxy["handler"].(string) != "reverse_proxy" {
		t.Fatalf("last handler = %v, want reverse_proxy", proxy["handler"])
	}

	fi, ok := proxy["flush_interval"]
	if !ok {
		t.Fatal("reverse_proxy handler missing flush_interval")
	}
	// JSON round-trip turns integers into float64.
	if fi.(float64) != -1 {
		t.Errorf("flush_interval = %v, want -1", fi)
	}
}

func TestCompile_TracingHandler(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
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

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	route := routes[0].(map[string]any)
	handlers := route["handle"].([]any)

	// Handler chain must be [tracing, vars, reverse_proxy].
	if len(handlers) != 3 {
		t.Fatalf("expected 3 handlers, got %d", len(handlers))
	}

	wantOrder := []string{"tracing", "vars", "reverse_proxy"}
	for i, want := range wantOrder {
		got := handlers[i].(map[string]any)["handler"].(string)
		if got != want {
			t.Errorf("handlers[%d].handler = %v, want %v", i, got, want)
		}
	}

	// Tracing handler must have span = "rioku".
	tracing := handlers[0].(map[string]any)
	if tracing["span"].(string) != "rioku" {
		t.Errorf("tracing span = %v, want rioku", tracing["span"])
	}
}

// TestLbPolicyString covers the RANDOM, LEAST_CONN, and IP_HASH policy cases.
func TestLbPolicyString(t *testing.T) {
	tests := []struct {
		policy riokuv1.LoadBalancingPolicy
		want   string
	}{
		{riokuv1.LoadBalancingPolicy_LB_POLICY_RANDOM, "random"},
		{riokuv1.LoadBalancingPolicy_LB_POLICY_LEAST_CONN, "least_conn"},
		{riokuv1.LoadBalancingPolicy_LB_POLICY_IP_HASH, "ip_hash"},
	}
	for _, tt := range tests {
		c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
		snapshot := &riokuv1.ConfigSnapshot{
			Routes: []*riokuv1.Route{
				{Id: "r1", Enabled: true, Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"}},
			},
			Services: []*riokuv1.Service{
				{
					Id:       "svc1",
					LbPolicy: tt.policy,
					Upstreams: []*riokuv1.Upstream{
						{Address: "10.0.0.1:8080"},
					},
				},
			},
		}
		data, err := c.Compile(snapshot)
		if err != nil {
			t.Fatalf("policy %v: Compile: %v", tt.policy, err)
		}
		var cfg map[string]any
		if err := json.Unmarshal(data, &cfg); err != nil {
			t.Fatalf("policy %v: unmarshal: %v", tt.policy, err)
		}
		server := dig(t, cfg, "apps", "http", "servers", "traffic")
		route := server["routes"].([]any)[0].(map[string]any)
		handler := route["handle"].([]any)[2].(map[string]any)
		lb := handler["load_balancing"].(map[string]any)
		sp := lb["selection_policy"].(map[string]any)
		if sp["policy"].(string) != tt.want {
			t.Errorf("policy %v: got %q, want %q", tt.policy, sp["policy"], tt.want)
		}
	}
}

func TestCompiler_ServiceWithAllTimeouts(t *testing.T) {
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:   "svc1",
				Name: "backend",
				Upstreams: []*riokuv1.Upstream{
					{Id: "u1", Address: "10.0.0.1:8080"},
				},
				DialTimeoutSeconds:           5,
				ResponseHeaderTimeoutSeconds: 30,
				IdleTimeoutSeconds:           120,
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	route := routes[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any) // [0]=tracing, [1]=vars, [2]=reverse_proxy

	transport, ok := handler["transport"].(map[string]any)
	if !ok {
		t.Fatal("expected transport block in reverse_proxy handler")
	}
	if transport["protocol"].(string) != "http" {
		t.Errorf("transport.protocol = %v, want http", transport["protocol"])
	}
	if transport["dial_timeout"].(string) != "5s" {
		t.Errorf("transport.dial_timeout = %v, want 5s", transport["dial_timeout"])
	}
	if transport["response_header_timeout"].(string) != "30s" {
		t.Errorf("transport.response_header_timeout = %v, want 30s", transport["response_header_timeout"])
	}

	keepAlive, ok := transport["keep_alive"].(map[string]any)
	if !ok {
		t.Fatal("expected keep_alive sub-object in transport")
	}
	if keepAlive["idle_conn_timeout"].(string) != "120s" {
		t.Errorf("transport.keep_alive.idle_conn_timeout = %v, want 120s", keepAlive["idle_conn_timeout"])
	}
}

func TestCompiler_ServiceWithPartialTimeouts(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target:  &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:                 "svc1",
				Upstreams:          []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
				DialTimeoutSeconds: 5,
				// ResponseHeaderTimeoutSeconds and IdleTimeoutSeconds are 0 (default).
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any)

	transport, ok := handler["transport"].(map[string]any)
	if !ok {
		t.Fatal("expected transport block when dial_timeout_seconds > 0")
	}
	if transport["dial_timeout"].(string) != "5s" {
		t.Errorf("transport.dial_timeout = %v, want 5s", transport["dial_timeout"])
	}
	// response_header_timeout should be absent (0 = omit).
	if _, ok := transport["response_header_timeout"]; ok {
		t.Error("response_header_timeout should not be present when 0")
	}
	// keep_alive should be absent (idle_timeout_seconds = 0).
	if _, ok := transport["keep_alive"]; ok {
		t.Error("keep_alive should not be present when idle_timeout_seconds is 0")
	}
}

func TestCompiler_ServiceWithNoTimeouts(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target:  &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:        "svc1",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
				// All timeouts are 0 (proto3 default).
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any)

	if _, ok := handler["transport"]; ok {
		t.Error("transport block should not be present when all timeouts are 0")
	}
}

func TestCompiler_TimeoutFormatting(t *testing.T) {
	tests := []struct {
		name     string
		seconds  int32
		wantDial string
	}{
		{"1 second", 1, "1s"},
		{"30 seconds", 30, "30s"},
		{"120 seconds", 120, "120s"},
		{"3600 seconds", 3600, "3600s"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

			snapshot := &riokuv1.ConfigSnapshot{
				Routes: []*riokuv1.Route{
					{
						Id:      "r1",
						Enabled: true,
						Target:  &riokuv1.Route_ServiceId{ServiceId: "svc1"},
					},
				},
				Services: []*riokuv1.Service{
					{
						Id:                 "svc1",
						Upstreams:          []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
						DialTimeoutSeconds: tt.seconds,
					},
				},
			}

			data, err := c.Compile(snapshot)
			if err != nil {
				t.Fatalf("Compile: %v", err)
			}

			var cfg map[string]any
			if err := json.Unmarshal(data, &cfg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}

			server := dig(t, cfg, "apps", "http", "servers", "traffic")
			route := server["routes"].([]any)[0].(map[string]any)
			handler := route["handle"].([]any)[2].(map[string]any)
			transport := handler["transport"].(map[string]any)

			if transport["dial_timeout"].(string) != tt.wantDial {
				t.Errorf("dial_timeout = %v, want %v", transport["dial_timeout"], tt.wantDial)
			}
		})
	}
}

func TestCompiler_SecurityHeadersAllDefaults(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		XFrameOptions:       "DENY",
		ReferrerPolicy:      "strict-origin-when-cross-origin",
		PermissionsPolicy:   "camera=(), microphone=(), geolocation=()",
		HSTS: HSTSConfig{
			Enabled:           true,
			MaxAge:            63072000,
			IncludeSubdomains: true,
		},
	}
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
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

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)

	// Handler chain: tracing, headers, vars, reverse_proxy
	if len(handlers) != 4 {
		t.Fatalf("expected 4 handlers, got %d", len(handlers))
	}

	wantOrder := []string{"tracing", "headers", "vars", "reverse_proxy"}
	for i, want := range wantOrder {
		got := handlers[i].(map[string]any)["handler"].(string)
		if got != want {
			t.Errorf("handlers[%d].handler = %v, want %v", i, got, want)
		}
	}

	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	checks := map[string]string{
		"X-Content-Type-Options":    "nosniff",
		"X-Frame-Options":           "DENY",
		"Referrer-Policy":           "strict-origin-when-cross-origin",
		"Permissions-Policy":        "camera=(), microphone=(), geolocation=()",
		"Strict-Transport-Security": "max-age=63072000; includeSubDomains",
	}
	for header, wantVal := range checks {
		vals, ok := set[header].([]any)
		if !ok {
			t.Errorf("header %q not found in set", header)
			continue
		}
		if len(vals) != 1 || vals[0].(string) != wantVal {
			t.Errorf("header %q = %v, want [%q]", header, vals, wantVal)
		}
	}

	// CSP should not be present (empty by default).
	if _, ok := set["Content-Security-Policy"]; ok {
		t.Error("Content-Security-Policy should not be present when CSP is empty")
	}
	if _, ok := set["Content-Security-Policy-Report-Only"]; ok {
		t.Error("Content-Security-Policy-Report-Only should not be present when CSP is empty")
	}
}

func TestCompiler_SecurityHeadersDisabled(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled: false,
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target: &riokuv1.Route_Upstream{
					Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"},
				},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)

	// Without security headers: tracing, vars, reverse_proxy (3 handlers).
	if len(handlers) != 3 {
		t.Fatalf("expected 3 handlers (no security headers), got %d", len(handlers))
	}
	wantOrder := []string{"tracing", "vars", "reverse_proxy"}
	for i, want := range wantOrder {
		got := handlers[i].(map[string]any)["handler"].(string)
		if got != want {
			t.Errorf("handlers[%d].handler = %v, want %v", i, got, want)
		}
	}
}

func TestCompiler_SecurityHeadersPartialEmpty(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		XFrameOptions:       "",          // empty = omit
		ReferrerPolicy:      "",          // empty = omit
		PermissionsPolicy:   "camera=()", // non-empty = include
		HSTS: HSTSConfig{
			Enabled: false,
		},
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Target: &riokuv1.Route_Upstream{
					Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"},
				},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	if len(handlers) != 4 {
		t.Fatalf("expected 4 handlers, got %d", len(handlers))
	}

	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	// Only non-empty headers should be present.
	if _, ok := set["X-Content-Type-Options"]; !ok {
		t.Error("X-Content-Type-Options should be present")
	}
	if _, ok := set["Permissions-Policy"]; !ok {
		t.Error("Permissions-Policy should be present")
	}
	if _, ok := set["X-Frame-Options"]; ok {
		t.Error("X-Frame-Options should not be present (empty)")
	}
	if _, ok := set["Referrer-Policy"]; ok {
		t.Error("Referrer-Policy should not be present (empty)")
	}
	if _, ok := set["Strict-Transport-Security"]; ok {
		t.Error("HSTS should not be present (disabled)")
	}
}

func TestCompiler_SecurityHeadersNoCSP(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		CSP:                 "", // empty = no CSP header
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	if _, ok := set["Content-Security-Policy"]; ok {
		t.Error("Content-Security-Policy should not be present when CSP is empty")
	}
	if _, ok := set["Content-Security-Policy-Report-Only"]; ok {
		t.Error("Content-Security-Policy-Report-Only should not be present when CSP is empty")
	}
}

func TestCompiler_SecurityHeadersWithCSP(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled:       true,
		CSP:           "default-src 'self'",
		CSPReportOnly: false,
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	vals, ok := set["Content-Security-Policy"].([]any)
	if !ok {
		t.Fatal("Content-Security-Policy not found")
	}
	if vals[0].(string) != "default-src 'self'" {
		t.Errorf("CSP = %v, want default-src 'self'", vals[0])
	}
	if _, ok := set["Content-Security-Policy-Report-Only"]; ok {
		t.Error("CSP-Report-Only should not be present when CSPReportOnly is false")
	}
}

func TestCompiler_SecurityHeadersWithCSPReportOnly(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled:       true,
		CSP:           "default-src 'self'",
		CSPReportOnly: true,
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	vals, ok := set["Content-Security-Policy-Report-Only"].([]any)
	if !ok {
		t.Fatal("Content-Security-Policy-Report-Only not found")
	}
	if vals[0].(string) != "default-src 'self'" {
		t.Errorf("CSP-Report-Only = %v, want default-src 'self'", vals[0])
	}
	if _, ok := set["Content-Security-Policy"]; ok {
		t.Error("Content-Security-Policy should not be present when CSPReportOnly is true")
	}
}

func TestCompiler_HSTSWithStandardPorts(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled: true,
		HSTS: HSTSConfig{
			Enabled:           true,
			MaxAge:            63072000,
			IncludeSubdomains: true,
		},
	}
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	vals, ok := set["Strict-Transport-Security"].([]any)
	if !ok {
		t.Fatal("Strict-Transport-Security not found")
	}
	if vals[0].(string) != "max-age=63072000; includeSubDomains" {
		t.Errorf("HSTS = %v, want max-age=63072000; includeSubDomains", vals[0])
	}
}

func TestCompiler_HSTSWithNonStandardPorts(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled: true,
		HSTS: HSTSConfig{
			Enabled:           true,
			MaxAge:            63072000,
			IncludeSubdomains: true,
		},
	}
	// Non-standard port -- HSTS should be suppressed.
	c := NewCompiler([]string{":8443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)

	// Check that HSTS is not in the output.
	for _, h := range handlers {
		hm := h.(map[string]any)
		if hm["handler"].(string) == "headers" {
			response := hm["response"].(map[string]any)
			set := response["set"].(map[string]any)
			if _, ok := set["Strict-Transport-Security"]; ok {
				t.Error("HSTS should not be present on non-standard ports")
			}
		}
	}
}

func TestCompiler_HSTSDisabled(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		HSTS: HSTSConfig{
			Enabled: false,
		},
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	if _, ok := set["Strict-Transport-Security"]; ok {
		t.Error("HSTS should not be present when disabled")
	}
}

func TestCompiler_HSTSNoSubdomains(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled: true,
		HSTS: HSTSConfig{
			Enabled:           true,
			MaxAge:            31536000,
			IncludeSubdomains: false,
		},
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	headersHandler := handlers[1].(map[string]any)
	response := headersHandler["response"].(map[string]any)
	set := response["set"].(map[string]any)

	vals := set["Strict-Transport-Security"].([]any)
	if vals[0].(string) != "max-age=31536000" {
		t.Errorf("HSTS = %v, want max-age=31536000 (no includeSubDomains)", vals[0])
	}
}

func TestCompiler_AllHeadersEmpty(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled:             true,
		XContentTypeOptions: "",
		XFrameOptions:       "",
		ReferrerPolicy:      "",
		PermissionsPolicy:   "",
		CSP:                 "",
		HSTS: HSTSConfig{
			Enabled: false,
		},
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, secHeaders)

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id: "r1", Enabled: true,
				Target: &riokuv1.Route_Upstream{Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)

	// When all headers are empty/disabled, no headers handler should be inserted.
	if len(handlers) != 3 {
		t.Fatalf("expected 3 handlers (no headers handler when all empty), got %d", len(handlers))
	}
	wantOrder := []string{"tracing", "vars", "reverse_proxy"}
	for i, want := range wantOrder {
		got := handlers[i].(map[string]any)["handler"].(string)
		if got != want {
			t.Errorf("handlers[%d].handler = %v, want %v", i, got, want)
		}
	}
}

func TestCompiler_SecurityHeadersNotOnAdmin(t *testing.T) {
	secHeaders := SecurityHeadersConfig{
		Enabled:             true,
		XContentTypeOptions: "nosniff",
		XFrameOptions:       "DENY",
	}
	c := NewCompiler([]string{":443"}, AdminConfig{
		InternalAddr: "127.0.0.1:54321",
		ListenAddr:   ":7778",
	}, "", nil, secHeaders)

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	servers := dig(t, cfg, "apps", "http", "servers")
	admin := servers["admin"].(map[string]any)
	adminRoutes := admin["routes"].([]any)
	adminRoute := adminRoutes[0].(map[string]any)
	adminHandlers := adminRoute["handle"].([]any)

	// Admin block should only have reverse_proxy, no headers handler.
	for _, h := range adminHandlers {
		hm := h.(map[string]any)
		if hm["handler"].(string) == "headers" {
			t.Error("admin server block should NOT have a headers handler")
		}
	}
}

func TestCompiler_ServiceWithHealthCheckAndTimeouts(t *testing.T) {
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:   "svc1",
				Name: "backend",
				Upstreams: []*riokuv1.Upstream{
					{Id: "u1", Address: "10.0.0.1:8080"},
					{Id: "u2", Address: "10.0.0.2:8080"},
				},
				LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				HealthCheck: &riokuv1.HealthCheck{
					Enabled:         true,
					Path:            "/health",
					IntervalSeconds: 10,
					TimeoutSeconds:  5,
				},
				DialTimeoutSeconds:           5,
				ResponseHeaderTimeoutSeconds: 30,
				IdleTimeoutSeconds:           120,
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	routes := server["routes"].([]any)
	route := routes[0].(map[string]any)
	handler := route["handle"].([]any)[2].(map[string]any) // [0]=tracing, [1]=vars, [2]=reverse_proxy

	// Verify health checks are present.
	hcs, ok := handler["health_checks"].(map[string]any)
	if !ok {
		t.Fatal("expected health_checks block")
	}
	active := hcs["active"].(map[string]any)
	if active["path"].(string) != "/health" {
		t.Errorf("health_check path = %v, want /health", active["path"])
	}
	if active["interval"].(string) != "10s" {
		t.Errorf("health_check interval = %v, want 10s", active["interval"])
	}
	if active["timeout"].(string) != "5s" {
		t.Errorf("health_check timeout = %v, want 5s", active["timeout"])
	}

	// Verify transport block is present alongside health checks.
	transport, ok := handler["transport"].(map[string]any)
	if !ok {
		t.Fatal("expected transport block")
	}
	if transport["protocol"].(string) != "http" {
		t.Errorf("transport.protocol = %v, want http", transport["protocol"])
	}
	if transport["dial_timeout"].(string) != "5s" {
		t.Errorf("transport.dial_timeout = %v, want 5s", transport["dial_timeout"])
	}
	if transport["response_header_timeout"].(string) != "30s" {
		t.Errorf("transport.response_header_timeout = %v, want 30s", transport["response_header_timeout"])
	}

	keepAlive := transport["keep_alive"].(map[string]any)
	if keepAlive["idle_conn_timeout"].(string) != "120s" {
		t.Errorf("keep_alive.idle_conn_timeout = %v, want 120s", keepAlive["idle_conn_timeout"])
	}

	// Verify load balancing is also present (all three blocks coexist).
	lb, ok := handler["load_balancing"].(map[string]any)
	if !ok {
		t.Fatal("expected load_balancing block")
	}
	sp := lb["selection_policy"].(map[string]any)
	if sp["policy"].(string) != "round_robin" {
		t.Errorf("lb policy = %v, want round_robin", sp["policy"])
	}
}

// dig navigates nested maps by key. It fails the test if any key is missing.
func dig(t *testing.T, m map[string]any, keys ...string) map[string]any {
	t.Helper()
	current := m
	for _, k := range keys {
		v, ok := current[k]
		if !ok {
			t.Fatalf("key %q not found in %v", k, current)
		}
		next, ok := v.(map[string]any)
		if !ok {
			t.Fatalf("key %q is not a map: %T", k, v)
		}
		current = next
	}
	return current
}

// ─── On-demand TLS (#66) ────────────────────────────────────────────────────

func TestCompile_OnDemandTLS_Disabled(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	// Note: SetOnDemandTLS not called — Enabled defaults to false.

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	apps := cfg["apps"].(map[string]any)
	if _, ok := apps["tls"]; ok {
		t.Error("apps.tls block should be omitted when on-demand TLS is disabled")
	}
}

func TestCompile_OnDemandTLS_Enabled(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	c.SetOnDemandTLS(OnDemandTLSConfig{
		Enabled: true,
		AskURL:  "http://127.0.0.1:7790/tls/ask",
	})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	tls := dig(t, cfg, "apps", "tls", "automation")
	onDemand := tls["on_demand"].(map[string]any)
	if got := onDemand["ask"].(string); got != "http://127.0.0.1:7790/tls/ask" {
		t.Errorf("ask URL = %q", got)
	}

	policies := tls["policies"].([]any)
	if len(policies) != 1 {
		t.Fatalf("expected 1 policy, got %d", len(policies))
	}
	p := policies[0].(map[string]any)
	if p["on_demand"].(bool) != true {
		t.Error("policy.on_demand should be true")
	}

	if _, has := onDemand["rate_limit"]; has {
		t.Error("rate_limit should be absent when interval/burst are zero")
	}
}

func TestCompile_OnDemandTLS_RateLimit(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	c.SetOnDemandTLS(OnDemandTLSConfig{
		Enabled:         true,
		AskURL:          "http://127.0.0.1:7790/tls/ask",
		IntervalSeconds: 60,
		Burst:           10,
	})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	onDemand := dig(t, cfg, "apps", "tls", "automation", "on_demand")
	rl, ok := onDemand["rate_limit"].(map[string]any)
	if !ok {
		t.Fatalf("rate_limit missing or wrong type: %T", onDemand["rate_limit"])
	}
	if rl["interval"].(string) != "60s" {
		t.Errorf("interval = %v, want 60s", rl["interval"])
	}
	// JSON numbers decode as float64.
	if rl["burst"].(float64) != 10 {
		t.Errorf("burst = %v, want 10", rl["burst"])
	}
}

// ─── Passive health checks (#67) ────────────────────────────────────────────

func TestCompile_PassiveHealthCheck_FullBlock(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id:      "r1",
			Enabled: true,
			Matchers: []*riokuv1.Matcher{
				{Hosts: []string{"api.example.com"}},
			},
			Target: &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:        "svc1",
			Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			PassiveHealthCheck: &riokuv1.PassiveHealthCheck{
				Enabled:               true,
				FailDurationSeconds:   30,
				MaxFails:              3,
				UnhealthyStatus:       []int32{500, 502, 503, 504},
				UnhealthyLatencyMs:    250,
				UnhealthyRequestCount: 100,
			},
		}},
	}

	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	handlers := route["handle"].([]any)
	rp := handlers[len(handlers)-1].(map[string]any)
	hcs := rp["health_checks"].(map[string]any)
	passive, ok := hcs["passive"].(map[string]any)
	if !ok {
		t.Fatalf("passive block missing or wrong type: %T", hcs["passive"])
	}
	if passive["fail_duration"] != "30s" {
		t.Errorf("fail_duration = %v", passive["fail_duration"])
	}
	if passive["max_fails"].(float64) != 3 {
		t.Errorf("max_fails = %v", passive["max_fails"])
	}
	if passive["unhealthy_latency"] != "250ms" {
		t.Errorf("unhealthy_latency = %v", passive["unhealthy_latency"])
	}
	if passive["unhealthy_request_count"].(float64) != 100 {
		t.Errorf("unhealthy_request_count = %v", passive["unhealthy_request_count"])
	}
	statuses := passive["unhealthy_status"].([]any)
	if len(statuses) != 4 || statuses[0].(float64) != 500 {
		t.Errorf("unhealthy_status = %v", statuses)
	}
}

func TestCompile_PassiveHealthCheck_DisabledOmits(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:        "svc1",
			Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			// Enabled=false despite having values — gate is enforced.
			PassiveHealthCheck: &riokuv1.PassiveHealthCheck{
				Enabled:  false,
				MaxFails: 3,
			},
		}},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	rp := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := rp[len(rp)-1].(map[string]any)
	if _, has := last["health_checks"]; has {
		t.Error("disabled passive (and no active) should leave health_checks omitted entirely")
	}
}

func TestCompile_PassiveHealthCheck_CoexistsWithActive(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:        "svc1",
			Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			HealthCheck: &riokuv1.HealthCheck{
				Enabled:         true,
				Path:            "/health",
				IntervalSeconds: 10,
			},
			PassiveHealthCheck: &riokuv1.PassiveHealthCheck{
				Enabled:  true,
				MaxFails: 3,
			},
		}},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	rp := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := rp[len(rp)-1].(map[string]any)
	hcs := last["health_checks"].(map[string]any)
	if _, has := hcs["active"]; !has {
		t.Error("active block missing")
	}
	if _, has := hcs["passive"]; !has {
		t.Error("passive block missing")
	}
}

func TestCompile_PassiveHealthCheck_EnabledWithNoThresholdsOmits(t *testing.T) {
	// Enabled=true but every threshold is zero — emitting an empty
	// passive block would be a Caddy no-op that just adds noise.
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:                 "svc1",
			Upstreams:          []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			PassiveHealthCheck: &riokuv1.PassiveHealthCheck{Enabled: true},
		}},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	rp := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := rp[len(rp)-1].(map[string]any)
	if _, has := last["health_checks"]; has {
		t.Error("empty passive + no active should leave health_checks omitted")
	}
}

// ─── Upstream TLS + connection pool (#70) ───────────────────────────────────

func TestCompile_UpstreamTLS_FullBlock(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:        "svc1",
			Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:443"}},
			UpstreamTls: &riokuv1.UpstreamTLS{
				Enabled:    true,
				ServerName: "internal.example.com",
				RootCaPem:  "-----BEGIN CERTIFICATE-----\nXYZ\n-----END CERTIFICATE-----\n",
				MinVersion: "1.2",
				MaxVersion: "1.3",
			},
		}},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	rp := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := rp[len(rp)-1].(map[string]any)
	transport := last["transport"].(map[string]any)
	if transport["protocol"] != "http" {
		t.Errorf("protocol = %v", transport["protocol"])
	}
	tls := transport["tls"].(map[string]any)
	if tls["server_name"] != "internal.example.com" {
		t.Errorf("server_name = %v", tls["server_name"])
	}
	if tls["protocol_min"] != "tls1.2" || tls["protocol_max"] != "tls1.3" {
		t.Errorf("min/max version = %v / %v", tls["protocol_min"], tls["protocol_max"])
	}
	cas := tls["root_ca_pem"].([]any)
	if len(cas) != 1 {
		t.Errorf("root_ca_pem entries = %d", len(cas))
	}
	if _, has := tls["insecure_skip_verify"]; has {
		t.Error("insecure_skip_verify should be omitted when false")
	}
}

func TestCompile_UpstreamTLS_DisabledOmits(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:          "svc1",
			Upstreams:   []*riokuv1.Upstream{{Address: "10.0.0.1:443"}},
			UpstreamTls: &riokuv1.UpstreamTLS{Enabled: false, ServerName: "x.com"},
		}},
	}
	data, _ := c.Compile(snap)
	var cfg map[string]any
	_ = json.Unmarshal(data, &cfg)
	rp := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := rp[len(rp)-1].(map[string]any)
	if _, has := last["transport"]; has {
		t.Error("disabled UpstreamTLS with no other transport fields should leave transport omitted")
	}
}

func TestCompile_UpstreamTLS_HalfMTLSDoesNotEmit(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:        "svc1",
			Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:443"}},
			UpstreamTls: &riokuv1.UpstreamTLS{
				Enabled:       true,
				ClientCertPem: "/etc/rioku/client.crt", // key missing
			},
		}},
	}
	data, _ := c.Compile(snap)
	var cfg map[string]any
	_ = json.Unmarshal(data, &cfg)
	tls := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := tls[len(tls)-1].(map[string]any)
	tlsBlock := last["transport"].(map[string]any)["tls"].(map[string]any)
	if _, has := tlsBlock["client_certificate_file"]; has {
		t.Error("half mTLS pair should not emit client_certificate_file")
	}
}

func TestCompile_ConnectionPool_FullBlock(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:        "svc1",
			Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			ConnectionPool: &riokuv1.ConnectionPool{
				MaxConnsPerUpstream:     200,
				MaxIdleConnsPerUpstream: 50,
				MaxIdleConns:            500,
				WriteBufferKb:           16,
				ReadBufferKb:            32,
			},
		}},
	}
	data, _ := c.Compile(snap)
	var cfg map[string]any
	_ = json.Unmarshal(data, &cfg)
	rp := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := rp[len(rp)-1].(map[string]any)
	transport := last["transport"].(map[string]any)
	if transport["max_conns_per_host"].(float64) != 200 {
		t.Errorf("max_conns_per_host = %v", transport["max_conns_per_host"])
	}
	if transport["write_buffer_size"].(float64) != 16*1024 {
		t.Errorf("write_buffer_size = %v", transport["write_buffer_size"])
	}
	if transport["read_buffer_size"].(float64) != 32*1024 {
		t.Errorf("read_buffer_size = %v", transport["read_buffer_size"])
	}
	keepAlive := transport["keep_alive"].(map[string]any)
	if keepAlive["max_idle_conns_per_host"].(float64) != 50 {
		t.Errorf("max_idle_conns_per_host = %v", keepAlive["max_idle_conns_per_host"])
	}
	if keepAlive["max_idle_conns"].(float64) != 500 {
		t.Errorf("max_idle_conns = %v", keepAlive["max_idle_conns"])
	}
}

// ─── Retry policy (#69) ─────────────────────────────────────────────────────

func TestCompile_RetryPolicy_FullBlock(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id: "svc1",
			Upstreams: []*riokuv1.Upstream{
				{Address: "10.0.0.1:8080"}, {Address: "10.0.0.2:8080"},
			},
			RetryPolicy: &riokuv1.RetryPolicy{
				Enabled:       true,
				MaxRetries:    3,
				RetryOnStatus: []int32{502, 503, 504},
				TryDurationMs: 5000,
				TryIntervalMs: 100,
			},
		}},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	rp := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := rp[len(rp)-1].(map[string]any)
	if last["lb_retries"].(float64) != 3 {
		t.Errorf("lb_retries = %v, want 3", last["lb_retries"])
	}
	if last["lb_try_duration"] != "5000ms" {
		t.Errorf("lb_try_duration = %v", last["lb_try_duration"])
	}
	if last["lb_try_interval"] != "100ms" {
		t.Errorf("lb_try_interval = %v", last["lb_try_interval"])
	}
	matchers := last["lb_retry_match"].([]any)
	if len(matchers) != 1 {
		t.Fatalf("expected 1 retry matcher, got %d", len(matchers))
	}
	statuses := matchers[0].(map[string]any)["status_code"].([]any)
	if len(statuses) != 3 || statuses[0].(float64) != 502 {
		t.Errorf("status_code = %v", statuses)
	}
}

func TestCompile_RetryPolicy_DisabledOmits(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:        "svc1",
			Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			// Configured but disabled — gate is enforced.
			RetryPolicy: &riokuv1.RetryPolicy{Enabled: false, MaxRetries: 5},
		}},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	rp := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := rp[len(rp)-1].(map[string]any)
	if _, has := last["lb_retries"]; has {
		t.Error("disabled retry policy should not emit lb_retries")
	}
}

func TestCompile_RetryPolicy_ZeroMaxRetriesOmits(t *testing.T) {
	// Enabled=true but max_retries=0 means "no retries", which is also
	// the no-config baseline. Suppress the block to avoid pushing a
	// no-op to Caddy.
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:          "svc1",
			Upstreams:   []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			RetryPolicy: &riokuv1.RetryPolicy{Enabled: true, MaxRetries: 0},
		}},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	rp := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)["routes"].([]any)[0].(map[string]any)["handle"].([]any)
	last := rp[len(rp)-1].(map[string]any)
	if _, has := last["lb_retries"]; has {
		t.Error("max_retries=0 should not emit lb_retries")
	}
}

func TestCompile_OnDemandTLS_EnabledWithoutAskURLSkips(t *testing.T) {
	// Misconfigured: Enabled=true but AskURL empty. Compiler must
	// refuse to emit the block — silently emitting on-demand without
	// the ask gate would let an attacker drive ACME issuance for
	// any host pointed at the gateway.
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	c.SetOnDemandTLS(OnDemandTLSConfig{Enabled: true, AskURL: ""})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, has := cfg["apps"].(map[string]any)["tls"]; has {
		t.Error("apps.tls must NOT be emitted when AskURL is empty")
	}
}

// ─── Subdomain wildcard cert (Plan 12 / T2) ─────────────────────────────────

func TestCompiler_EmitsSubdomainCert(t *testing.T) {
	// When SetSubdomainCert is called with both files set, the compiled
	// config must include apps.tls.certificates.load_files so Caddy
	// serves the wildcard leaf for *.<parent_domain> handshakes
	// without ACME (Plan 12 T2).
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	c.SetSubdomainCert(SubdomainCertConfig{
		CertFile: "/etc/rioku/certs/wildcard.pem",
		KeyFile:  "/etc/rioku/certs/wildcard.key",
	})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	certs := dig(t, cfg, "apps", "tls", "certificates")
	loadFiles, ok := certs["load_files"].([]any)
	if !ok {
		t.Fatalf("load_files missing or wrong type: %T", certs["load_files"])
	}
	if len(loadFiles) != 1 {
		t.Fatalf("expected 1 load_files entry, got %d", len(loadFiles))
	}
	entry := loadFiles[0].(map[string]any)
	if entry["certificate"].(string) != "/etc/rioku/certs/wildcard.pem" {
		t.Errorf("certificate = %v", entry["certificate"])
	}
	if entry["key"].(string) != "/etc/rioku/certs/wildcard.key" {
		t.Errorf("key = %v", entry["key"])
	}

	// Subdomain cert alone must NOT pull in on-demand TLS automation.
	tls := cfg["apps"].(map[string]any)["tls"].(map[string]any)
	if _, has := tls["automation"]; has {
		t.Error("automation must not be emitted when only subdomain cert is set")
	}
}

func TestCompiler_OmitsSubdomainCertWhenUnset(t *testing.T) {
	// When SetSubdomainCert is not called (or partially set), the
	// compiled config must NOT include apps.tls.certificates.
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, has := cfg["apps"].(map[string]any)["tls"]; has {
		t.Error("apps.tls must be omitted when subdomain cert is unset and on-demand is off")
	}

	// Partial config (cert only, key empty) must also not emit.
	c2 := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	c2.SetSubdomainCert(SubdomainCertConfig{CertFile: "/etc/rioku/cert.pem"})
	data2, err := c2.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile partial: %v", err)
	}
	var cfg2 map[string]any
	if err := json.Unmarshal(data2, &cfg2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, has := cfg2["apps"].(map[string]any)["tls"]; has {
		t.Error("apps.tls must be omitted when only CertFile is set without KeyFile")
	}
}

func TestCompiler_SubdomainCertCoexistsWithOnDemand(t *testing.T) {
	// Subdomain cert and on-demand TLS are independent features. When
	// both are configured, the compiled tls block contains BOTH the
	// load_files entry and the automation/on_demand block.
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	c.SetOnDemandTLS(OnDemandTLSConfig{
		Enabled: true,
		AskURL:  "http://127.0.0.1:7790/tls/ask",
	})
	c.SetSubdomainCert(SubdomainCertConfig{
		CertFile: "/tmp/wildcard.pem",
		KeyFile:  "/tmp/wildcard.key",
	})

	data, err := c.Compile(&riokuv1.ConfigSnapshot{})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	tls := cfg["apps"].(map[string]any)["tls"].(map[string]any)
	if _, has := tls["automation"]; !has {
		t.Error("automation must be present when on-demand is enabled")
	}
	if _, has := tls["certificates"]; !has {
		t.Error("certificates.load_files must be present when subdomain cert is set")
	}
}

// ─── Phase 7a / #161: service-level Caddy primitives ────────────────────────

// compileServiceSnap is a test helper that compiles a snapshot with a single
// route targeting svc and returns the route's handler chain as a []map[string]any.
func compileServiceSnap(t *testing.T, svc *riokuv1.Service) []map[string]any {
	t.Helper()
	if svc.Id == "" {
		svc.Id = "svc1"
	}
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id:      "r1",
			Enabled: true,
			Matchers: []*riokuv1.Matcher{
				{Hosts: []string{"api.example.com"}},
			},
			Target: &riokuv1.Route_ServiceId{ServiceId: svc.Id},
		}},
		Services: []*riokuv1.Service{svc},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	route := server["routes"].([]any)[0].(map[string]any)
	raw := route["handle"].([]any)
	chain := make([]map[string]any, len(raw))
	for i, h := range raw {
		chain[i] = h.(map[string]any)
	}
	return chain
}

// TestCompile_RequestHeaders verifies that a RequestHeaders proto produces a
// dedicated `headers` handler placed BEFORE the reverse_proxy, with the
// expected request.set/add/delete structure.
func TestCompile_RequestHeaders(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		RequestHeaders: &riokuv1.RequestHeaders{
			Set:    map[string]string{"X-Custom": "v1"},
			Add:    map[string]string{"X-Trace": "id"},
			Delete: []string{"X-Internal"},
		},
	})

	// Last handler must be reverse_proxy.
	last := chain[len(chain)-1]
	if last["handler"] != "reverse_proxy" {
		t.Fatalf("last handler = %v, want reverse_proxy", last["handler"])
	}

	// Second-to-last must be the headers handler.
	headersH := chain[len(chain)-2]
	if headersH["handler"] != "headers" {
		t.Fatalf("handler before reverse_proxy = %v, want headers", headersH["handler"])
	}

	req, ok := headersH["request"].(map[string]any)
	if !ok {
		t.Fatalf("headers handler missing request block")
	}

	setM, ok := req["set"].(map[string]any)
	if !ok {
		t.Fatalf("request.set missing or wrong type")
	}
	setVals := setM["X-Custom"].([]any)
	if len(setVals) != 1 || setVals[0].(string) != "v1" {
		t.Errorf("request.set[X-Custom] = %v, want [v1]", setVals)
	}

	addM, ok := req["add"].(map[string]any)
	if !ok {
		t.Fatalf("request.add missing or wrong type")
	}
	addVals := addM["X-Trace"].([]any)
	if len(addVals) != 1 || addVals[0].(string) != "id" {
		t.Errorf("request.add[X-Trace] = %v, want [id]", addVals)
	}

	delList := req["delete"].([]any)
	if len(delList) != 1 || delList[0].(string) != "X-Internal" {
		t.Errorf("request.delete = %v, want [X-Internal]", delList)
	}
}

// TestCompile_ResponseHeaders verifies that a ResponseHeaders proto embeds a
// headers.response block into the reverse_proxy handler.
func TestCompile_ResponseHeaders(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseHeaders: &riokuv1.ResponseHeaders{
			Set:    map[string]string{"X-Frame-Options": "DENY"},
			Add:    map[string]string{"X-Request-ID": "trace"},
			Delete: []string{"X-Powered-By"},
		},
	})

	rp := chain[len(chain)-1]
	if rp["handler"] != "reverse_proxy" {
		t.Fatalf("last handler = %v, want reverse_proxy", rp["handler"])
	}

	headers, ok := rp["headers"].(map[string]any)
	if !ok {
		t.Fatalf("reverse_proxy.headers missing")
	}
	resp, ok := headers["response"].(map[string]any)
	if !ok {
		t.Fatalf("reverse_proxy.headers.response missing")
	}

	setM := resp["set"].(map[string]any)
	setVals := setM["X-Frame-Options"].([]any)
	if len(setVals) != 1 || setVals[0].(string) != "DENY" {
		t.Errorf("response.set[X-Frame-Options] = %v, want [DENY]", setVals)
	}

	delList := resp["delete"].([]any)
	if len(delList) != 1 || delList[0].(string) != "X-Powered-By" {
		t.Errorf("response.delete = %v, want [X-Powered-By]", delList)
	}
}

// TestCompile_ResponseRules_Rewrite verifies that a ResponseRule with a Rewrite
// action produces a reverse_proxy.handle_response entry with a rewrite handler.
func TestCompile_ResponseRules_Rewrite(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"502"},
				Action: &riokuv1.ResponseRule_Rewrite{
					Rewrite: &riokuv1.ResponseRewrite{Uri: "/error"},
				},
			},
		},
	})

	rp := chain[len(chain)-1]
	if rp["handler"] != "reverse_proxy" {
		t.Fatalf("last handler = %v, want reverse_proxy", rp["handler"])
	}

	hrArr, ok := rp["handle_response"].([]any)
	if !ok || len(hrArr) == 0 {
		t.Fatalf("handle_response missing or empty")
	}
	hr := hrArr[0].(map[string]any)

	match := hr["match"].(map[string]any)
	codes := match["status_code"].([]any)
	if len(codes) != 1 || int(codes[0].(float64)) != 502 {
		t.Errorf("match.status_code = %v, want [502]", codes)
	}

	routes := hr["routes"].([]any)
	handle := routes[0].(map[string]any)["handle"].([]any)
	rwHandler := handle[0].(map[string]any)
	if rwHandler["handler"] != "rewrite" {
		t.Errorf("handler = %v, want rewrite", rwHandler["handler"])
	}
	if rwHandler["uri"] != "/error" {
		t.Errorf("uri = %v, want /error", rwHandler["uri"])
	}
}

// TestCompile_ResponseRules_ServeErrorPage verifies that a ResponseRule with a
// ServeErrorPage action produces a static_response handler with the expected
// status_code, body, and Content-Type header.
func TestCompile_ResponseRules_ServeErrorPage(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"503"},
				Action: &riokuv1.ResponseRule_ServeErrorPage{
					ServeErrorPage: &riokuv1.ResponseErrorPage{
						StatusCode:  503,
						Body:        "<h1>Down</h1>",
						ContentType: "text/html; charset=utf-8",
					},
				},
			},
		},
	})

	rp := chain[len(chain)-1]
	hrArr := rp["handle_response"].([]any)
	hr := hrArr[0].(map[string]any)

	match := hr["match"].(map[string]any)
	codes := match["status_code"].([]any)
	if len(codes) != 1 || int(codes[0].(float64)) != 503 {
		t.Errorf("match.status_code = %v, want [503]", codes)
	}

	routes := hr["routes"].([]any)
	handle := routes[0].(map[string]any)["handle"].([]any)
	sr := handle[0].(map[string]any)
	if sr["handler"] != "static_response" {
		t.Errorf("handler = %v, want static_response", sr["handler"])
	}
	if int(sr["status_code"].(float64)) != 503 {
		t.Errorf("status_code = %v, want 503", sr["status_code"])
	}
	if sr["body"] != "<h1>Down</h1>" {
		t.Errorf("body = %v, want <h1>Down</h1>", sr["body"])
	}
	hdrs := sr["headers"].(map[string]any)
	ct := hdrs["Content-Type"].([]any)
	if len(ct) != 1 || ct[0].(string) != "text/html; charset=utf-8" {
		t.Errorf("Content-Type = %v, want [text/html; charset=utf-8]", ct)
	}
}

// TestCompile_ResponseRules_Wildcard verifies that a "5xx" wildcard in
// match_status_codes expands to all 100 codes in the 500-599 range.
func TestCompile_ResponseRules_Wildcard(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"5xx"},
				Action: &riokuv1.ResponseRule_ServeErrorPage{
					ServeErrorPage: &riokuv1.ResponseErrorPage{Body: "error"},
				},
			},
		},
	})

	rp := chain[len(chain)-1]
	hrArr := rp["handle_response"].([]any)
	hr := hrArr[0].(map[string]any)

	match := hr["match"].(map[string]any)
	codes := match["status_code"].([]any)
	if len(codes) != 100 {
		t.Errorf("expanded 5xx should produce 100 codes, got %d", len(codes))
	}
	// Verify first and last entries are 500 and 599.
	if int(codes[0].(float64)) != 500 {
		t.Errorf("codes[0] = %v, want 500", codes[0])
	}
	if int(codes[99].(float64)) != 599 {
		t.Errorf("codes[99] = %v, want 599", codes[99])
	}
}

// TestCompile_Compression_Enabled verifies that a Compression proto with
// Enabled=true produces a dedicated `encode` handler before the reverse_proxy.
func TestCompile_Compression_Enabled(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		Compression: &riokuv1.Compression{
			Enabled:   true,
			Encodings: []string{"zstd", "gzip"},
			MinLength: 2048,
		},
	})

	// Last handler is reverse_proxy; second-to-last should be encode.
	last := chain[len(chain)-1]
	if last["handler"] != "reverse_proxy" {
		t.Fatalf("last handler = %v, want reverse_proxy", last["handler"])
	}

	encHandler := chain[len(chain)-2]
	if encHandler["handler"] != "encode" {
		t.Fatalf("handler before reverse_proxy = %v, want encode", encHandler["handler"])
	}

	encs := encHandler["encodings"].(map[string]any)
	if _, ok := encs["gzip"]; !ok {
		t.Error("encodings missing gzip")
	}
	if _, ok := encs["zstd"]; !ok {
		t.Error("encodings missing zstd")
	}

	if encHandler["minimum_length"].(float64) != 2048 {
		t.Errorf("minimum_length = %v, want 2048", encHandler["minimum_length"])
	}
}

// TestCompile_Compression_Disabled verifies that Compression{Enabled:false}
// does NOT produce an encode handler in the route's handler chain.
func TestCompile_Compression_Disabled(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		Compression: &riokuv1.Compression{
			Enabled:   false,
			Encodings: []string{"gzip"},
		},
	})

	for _, h := range chain {
		if h["handler"] == "encode" {
			t.Error("encode handler must NOT appear when Compression.Enabled is false")
		}
	}
}

// ---------------------------------------------------------------------------
// Phase 7b (#162, #159 residual) — dynamic upstreams, buffers, trusted_proxies
// ---------------------------------------------------------------------------

// TestCompile_DynamicUpstream_Srv verifies that a Service with a single
// SrvLookup upstream compiles to reverse_proxy.dynamic_upstreams with
// source="srv".
func TestCompile_DynamicUpstream_Srv(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id: "svc1",
		Upstreams: []*riokuv1.Upstream{
			{
				Id: "u1",
				Source: &riokuv1.Upstream_SrvLookup{
					SrvLookup: &riokuv1.SrvLookup{
						Service:        "_http._tcp.api.example.com",
						Proto:          "tcp",
						RefreshSeconds: 30,
					},
				},
			},
		},
	})

	rp := chain[len(chain)-1]
	if rp["handler"] != "reverse_proxy" {
		t.Fatalf("last handler = %v, want reverse_proxy", rp["handler"])
	}
	dyn, ok := rp["dynamic_upstreams"].(map[string]any)
	if !ok {
		t.Fatal("dynamic_upstreams not set on reverse_proxy")
	}
	if dyn["source"] != "srv" {
		t.Errorf("dynamic_upstreams.source = %v, want srv", dyn["source"])
	}
	if dyn["service"] != "_http._tcp.api.example.com" {
		t.Errorf("dynamic_upstreams.service = %v, want _http._tcp.api.example.com", dyn["service"])
	}
	if dyn["proto"] != "tcp" {
		t.Errorf("dynamic_upstreams.proto = %v, want tcp", dyn["proto"])
	}
	// JSON unmarshal converts int64 to float64.
	wantRefresh := float64(30 * 1_000_000_000)
	if dyn["refresh"] != wantRefresh {
		t.Errorf("dynamic_upstreams.refresh = %v, want %v (nanoseconds)", dyn["refresh"], wantRefresh)
	}
	// upstreams array must be present (empty) alongside dynamic_upstreams.
	// JSON unmarshal yields []any, not []map[string]any.
	ups, ok := rp["upstreams"].([]any)
	if !ok {
		t.Fatal("upstreams key missing from reverse_proxy when dynamic source set")
	}
	if len(ups) != 0 {
		t.Errorf("upstreams len = %d, want 0 when using dynamic source", len(ups))
	}
}

// TestCompile_DynamicUpstream_A verifies that a Service with an ALookup
// upstream compiles to reverse_proxy.dynamic_upstreams with source="a".
func TestCompile_DynamicUpstream_A(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id: "svc1",
		Upstreams: []*riokuv1.Upstream{
			{
				Id: "u1",
				Source: &riokuv1.Upstream_ALookup{
					ALookup: &riokuv1.ALookup{
						Name:           "api.example.com",
						Port:           8080,
						RefreshSeconds: 120,
					},
				},
			},
		},
	})

	rp := chain[len(chain)-1]
	dyn, ok := rp["dynamic_upstreams"].(map[string]any)
	if !ok {
		t.Fatal("dynamic_upstreams not set on reverse_proxy")
	}
	if dyn["source"] != "a" {
		t.Errorf("dynamic_upstreams.source = %v, want a", dyn["source"])
	}
	if dyn["name"] != "api.example.com" {
		t.Errorf("dynamic_upstreams.name = %v, want api.example.com", dyn["name"])
	}
	if dyn["port"] != "8080" {
		t.Errorf("dynamic_upstreams.port = %v, want 8080", dyn["port"])
	}
	wantRefresh := float64(120 * 1_000_000_000)
	if dyn["refresh"] != wantRefresh {
		t.Errorf("dynamic_upstreams.refresh = %v, want %v", dyn["refresh"], wantRefresh)
	}
}

// TestCompile_DynamicUpstream_DefaultRefresh verifies that a zero
// RefreshSeconds on SrvLookup falls back to the 60s default.
func TestCompile_DynamicUpstream_DefaultRefresh(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id: "svc1",
		Upstreams: []*riokuv1.Upstream{
			{
				Source: &riokuv1.Upstream_SrvLookup{
					SrvLookup: &riokuv1.SrvLookup{
						Service:        "_grpc._tcp.svc.example.com",
						RefreshSeconds: 0, // should default to 60s
					},
				},
			},
		},
	})
	rp := chain[len(chain)-1]
	dyn := rp["dynamic_upstreams"].(map[string]any)
	wantRefresh := float64(60 * 1_000_000_000)
	if dyn["refresh"] != wantRefresh {
		t.Errorf("dynamic_upstreams.refresh = %v, want %v (default 60s)", dyn["refresh"], wantRefresh)
	}
	// proto is omitted when empty.
	if _, has := dyn["proto"]; has {
		t.Error("proto should be omitted when SrvLookup.Proto is empty")
	}
}

// TestCompile_DynamicUpstream_MixedError verifies that mixing static and
// dynamic upstreams in a single Service is rejected at compile time.
func TestCompile_DynamicUpstream_MixedError(t *testing.T) {
	c := NewCompiler([]string{":8080"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id: "svc1",
			Upstreams: []*riokuv1.Upstream{
				{Id: "u1", Address: "10.0.0.1:8080"}, // static
				{
					Id: "u2",
					Source: &riokuv1.Upstream_SrvLookup{
						SrvLookup: &riokuv1.SrvLookup{Service: "_http._tcp.api.example.com"},
					},
				}, // dynamic
			},
		}},
	}
	_, err := c.Compile(snap)
	if err == nil {
		t.Fatal("expected error for mixed static+dynamic upstreams, got nil")
	}
}

// TestCompile_RequestResponseBuffers verifies that non-zero RequestBuffers
// and ResponseBuffers on UpstreamTLS compile into transport.{request,response}_buffers.
func TestCompile_RequestResponseBuffers(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:443"}},
		UpstreamTls: &riokuv1.UpstreamTLS{
			Enabled:         true,
			RequestBuffers:  8192,
			ResponseBuffers: 16384,
		},
	})

	rp := chain[len(chain)-1]
	transport, ok := rp["transport"].(map[string]any)
	if !ok {
		t.Fatal("transport block missing from reverse_proxy")
	}
	// JSON unmarshal yields float64 for numeric values.
	if transport["request_buffers"] != float64(8192) {
		t.Errorf("transport.request_buffers = %v, want 8192", transport["request_buffers"])
	}
	if transport["response_buffers"] != float64(16384) {
		t.Errorf("transport.response_buffers = %v, want 16384", transport["response_buffers"])
	}
}

// TestCompile_RequestResponseBuffers_ZeroOmitted verifies that zero-value
// buffer sizes are not emitted (let Caddy use its defaults).
func TestCompile_RequestResponseBuffers_ZeroOmitted(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:443"}},
		UpstreamTls: &riokuv1.UpstreamTLS{
			Enabled:         true,
			RequestBuffers:  0,
			ResponseBuffers: 0,
		},
	})

	rp := chain[len(chain)-1]
	if transport, ok := rp["transport"].(map[string]any); ok {
		if _, has := transport["request_buffers"]; has {
			t.Error("request_buffers must not be emitted when zero")
		}
		if _, has := transport["response_buffers"]; has {
			t.Error("response_buffers must not be emitted when zero")
		}
	}
}

// TestCompile_TrustedProxies_StaticOnly verifies that a static-only
// TrustedProxiesConfig emits the standard static source block.
func TestCompile_TrustedProxies_StaticOnly(t *testing.T) {
	tp := &TrustedProxiesConfig{
		Ranges: []string{"10.0.0.0/8", "192.168.0.0/16"},
	}
	c := NewCompiler([]string{":8080"}, AdminConfig{}, "", tp, SecurityHeadersConfig{})
	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:        "svc1",
			Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		}},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	srv := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)
	tpBlock, ok := srv["trusted_proxies"].(map[string]any)
	if !ok {
		t.Fatal("trusted_proxies block missing from server")
	}
	if tpBlock["source"] != "static" {
		t.Errorf("trusted_proxies.source = %v, want static", tpBlock["source"])
	}
	// JSON unmarshal yields []any, not []string.
	ranges, ok := tpBlock["ranges"].([]any)
	if !ok {
		t.Fatalf("trusted_proxies.ranges wrong type: %T", tpBlock["ranges"])
	}
	if len(ranges) != 2 {
		t.Fatalf("trusted_proxies.ranges len = %d, want 2", len(ranges))
	}
}

// TestCompile_TrustedProxies_StaticPlusDynamic verifies that a config with
// both static ranges and a dynamic (cloudflare) strategy emits a dynamic
// source block.
func TestCompile_TrustedProxies_StaticPlusDynamic(t *testing.T) {
	tp := &TrustedProxiesConfig{
		Ranges: []string{"10.0.0.0/8"},
		Dynamic: []TrustedProxiesDynamicConfig{
			{Strategy: "cloudflare", RefreshSeconds: 7200},
		},
	}
	c := NewCompiler([]string{":8080"}, AdminConfig{}, "", tp, SecurityHeadersConfig{})
	snap := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{{
			Id: "r1", Enabled: true,
			Matchers: []*riokuv1.Matcher{{Hosts: []string{"a.com"}}},
			Target:   &riokuv1.Route_ServiceId{ServiceId: "svc1"},
		}},
		Services: []*riokuv1.Service{{
			Id:        "svc1",
			Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		}},
	}
	data, err := c.Compile(snap)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	srv := cfg["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)["traffic"].(map[string]any)
	tpBlock, ok := srv["trusted_proxies"].(map[string]any)
	if !ok {
		t.Fatal("trusted_proxies block missing from server")
	}
	if tpBlock["source"] != "cloudflare" {
		t.Errorf("trusted_proxies.source = %v, want cloudflare", tpBlock["source"])
	}
}

// TestCompile_TrustedProxies_NilOmitted verifies that a nil TrustedProxiesConfig
// produces no trusted_proxies key in the server block.
func TestCompile_TrustedProxies_NilOmitted(t *testing.T) {
	block := buildTrustedProxiesBlock(nil)
	if block != nil {
		t.Errorf("buildTrustedProxiesBlock(nil) = %v, want nil", block)
	}
}

// TestCompile_TrustedProxies_EmptyOmitted verifies that a TrustedProxiesConfig
// with no ranges and no dynamic entries produces no block.
func TestCompile_TrustedProxies_EmptyOmitted(t *testing.T) {
	block := buildTrustedProxiesBlock(&TrustedProxiesConfig{})
	if block != nil {
		t.Errorf("buildTrustedProxiesBlock({}) = %v, want nil", block)
	}
}

// ---------------------------------------------------------------------------
// Phase 3e — round-trip coverage for Sprint-1 Caddy primitives (#161, #162,
// #159 residual). The primitive-level integration tests above (added in
// commits c931015 / fa85704) assert combined behavior; the cases below
// cover per-operation isolation, default values, and omission semantics
// flagged by the Phase 4a sandbox audit and Phase 3a test categorization.
// ---------------------------------------------------------------------------

// findHandler walks a route's handler chain and returns the first handler
// matching the given handler name, or nil if not found. Used to assert
// presence/absence of `headers`, `encode`, etc. before reverse_proxy.
func findHandler(chain []map[string]any, name string) map[string]any {
	for _, h := range chain {
		if h["handler"] == name {
			return h
		}
	}
	return nil
}

// TestCompile_RequestHeaders_AddOnly verifies that a RequestHeaders proto with
// only `add` populated produces a request block containing add and no set/delete.
func TestCompile_RequestHeaders_AddOnly(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		RequestHeaders: &riokuv1.RequestHeaders{
			Add: map[string]string{"X-Trace": "trace-id"},
		},
	})
	h := findHandler(chain, "headers")
	if h == nil {
		t.Fatal("headers handler missing from chain")
	}
	req, ok := h["request"].(map[string]any)
	if !ok {
		t.Fatalf("headers.request missing or wrong type")
	}
	if _, has := req["set"]; has {
		t.Error("request.set must not be present when only add is configured")
	}
	if _, has := req["delete"]; has {
		t.Error("request.delete must not be present when only add is configured")
	}
	addM, ok := req["add"].(map[string]any)
	if !ok {
		t.Fatalf("request.add missing or wrong type")
	}
	vals := addM["X-Trace"].([]any)
	if len(vals) != 1 || vals[0].(string) != "trace-id" {
		t.Errorf("request.add[X-Trace] = %v, want [trace-id]", vals)
	}
}

// TestCompile_RequestHeaders_SetOnly verifies that a RequestHeaders proto with
// only `set` populated produces a request block containing set and no add/delete.
func TestCompile_RequestHeaders_SetOnly(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		RequestHeaders: &riokuv1.RequestHeaders{
			Set: map[string]string{"Host": "internal.example.com"},
		},
	})
	h := findHandler(chain, "headers")
	if h == nil {
		t.Fatal("headers handler missing from chain")
	}
	req := h["request"].(map[string]any)
	if _, has := req["add"]; has {
		t.Error("request.add must not be present when only set is configured")
	}
	if _, has := req["delete"]; has {
		t.Error("request.delete must not be present when only set is configured")
	}
	setM := req["set"].(map[string]any)
	vals := setM["Host"].([]any)
	if len(vals) != 1 || vals[0].(string) != "internal.example.com" {
		t.Errorf("request.set[Host] = %v, want [internal.example.com]", vals)
	}
}

// TestCompile_RequestHeaders_DeleteOnly verifies that a RequestHeaders proto with
// only `delete` populated produces a request block containing delete and no set/add.
func TestCompile_RequestHeaders_DeleteOnly(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		RequestHeaders: &riokuv1.RequestHeaders{
			Delete: []string{"X-Internal-Token", "X-Debug"},
		},
	})
	h := findHandler(chain, "headers")
	if h == nil {
		t.Fatal("headers handler missing from chain")
	}
	req := h["request"].(map[string]any)
	if _, has := req["add"]; has {
		t.Error("request.add must not be present when only delete is configured")
	}
	if _, has := req["set"]; has {
		t.Error("request.set must not be present when only delete is configured")
	}
	delList := req["delete"].([]any)
	if len(delList) != 2 {
		t.Fatalf("request.delete len = %d, want 2", len(delList))
	}
}

// TestCompile_RequestHeaders_NilOmitsHandler verifies that a Service with
// RequestHeaders=nil produces no `headers` handler in the chain (only the
// reverse_proxy handler should be present).
func TestCompile_RequestHeaders_NilOmitsHandler(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:             "svc1",
		Upstreams:      []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		RequestHeaders: nil,
	})
	if h := findHandler(chain, "headers"); h != nil {
		t.Errorf("headers handler must not appear when RequestHeaders is nil; got %v", h)
	}
}

// TestCompile_RequestHeaders_AllEmptyOmitsHandler verifies that a non-nil
// RequestHeaders proto with all maps/slices empty produces no `headers`
// handler (the builder returns nil when there's nothing to do).
func TestCompile_RequestHeaders_AllEmptyOmitsHandler(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:             "svc1",
		Upstreams:      []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		RequestHeaders: &riokuv1.RequestHeaders{},
	})
	if h := findHandler(chain, "headers"); h != nil {
		t.Errorf("headers handler must not appear when RequestHeaders is empty; got %v", h)
	}
}

// TestCompile_ResponseHeaders_AddOnly verifies that ResponseHeaders with only
// `add` populated emits a reverse_proxy.headers.response block containing
// only add (no set, no delete).
func TestCompile_ResponseHeaders_AddOnly(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseHeaders: &riokuv1.ResponseHeaders{
			Add: map[string]string{"Set-Cookie": "session=xyz"},
		},
	})
	rp := chain[len(chain)-1]
	headers := rp["headers"].(map[string]any)
	resp := headers["response"].(map[string]any)
	if _, has := resp["set"]; has {
		t.Error("response.set must not appear when only add configured")
	}
	if _, has := resp["delete"]; has {
		t.Error("response.delete must not appear when only add configured")
	}
	addM := resp["add"].(map[string]any)
	vals := addM["Set-Cookie"].([]any)
	if len(vals) != 1 || vals[0].(string) != "session=xyz" {
		t.Errorf("response.add[Set-Cookie] = %v, want [session=xyz]", vals)
	}
}

// TestCompile_ResponseHeaders_SetOnly verifies ResponseHeaders with only `set`.
func TestCompile_ResponseHeaders_SetOnly(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseHeaders: &riokuv1.ResponseHeaders{
			Set: map[string]string{"X-Frame-Options": "DENY"},
		},
	})
	rp := chain[len(chain)-1]
	headers := rp["headers"].(map[string]any)
	resp := headers["response"].(map[string]any)
	if _, has := resp["add"]; has {
		t.Error("response.add must not appear when only set configured")
	}
	if _, has := resp["delete"]; has {
		t.Error("response.delete must not appear when only set configured")
	}
	setM := resp["set"].(map[string]any)
	vals := setM["X-Frame-Options"].([]any)
	if len(vals) != 1 || vals[0].(string) != "DENY" {
		t.Errorf("response.set[X-Frame-Options] = %v, want [DENY]", vals)
	}
}

// TestCompile_ResponseHeaders_DeleteOnly verifies ResponseHeaders with only `delete`.
func TestCompile_ResponseHeaders_DeleteOnly(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseHeaders: &riokuv1.ResponseHeaders{
			Delete: []string{"Server", "X-Powered-By"},
		},
	})
	rp := chain[len(chain)-1]
	headers := rp["headers"].(map[string]any)
	resp := headers["response"].(map[string]any)
	if _, has := resp["add"]; has {
		t.Error("response.add must not appear when only delete configured")
	}
	if _, has := resp["set"]; has {
		t.Error("response.set must not appear when only delete configured")
	}
	delList := resp["delete"].([]any)
	if len(delList) != 2 {
		t.Fatalf("response.delete len = %d, want 2", len(delList))
	}
}

// TestCompile_ResponseHeaders_NilOmitsBlock verifies that a Service with
// ResponseHeaders=nil produces no `headers` key inside the reverse_proxy
// handler.
func TestCompile_ResponseHeaders_NilOmitsBlock(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:              "svc1",
		Upstreams:       []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseHeaders: nil,
	})
	rp := chain[len(chain)-1]
	if _, has := rp["headers"]; has {
		t.Error("reverse_proxy.headers must not appear when ResponseHeaders is nil")
	}
}

// TestCompile_ResponseHeaders_AllEmptyOmitsBlock verifies that a non-nil
// ResponseHeaders proto with every field empty produces no headers block.
func TestCompile_ResponseHeaders_AllEmptyOmitsBlock(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:              "svc1",
		Upstreams:       []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseHeaders: &riokuv1.ResponseHeaders{},
	})
	rp := chain[len(chain)-1]
	if _, has := rp["headers"]; has {
		t.Error("reverse_proxy.headers must not appear when ResponseHeaders is empty")
	}
}

// TestCompile_Compression_GzipOnly verifies that Compression with only gzip
// produces an `encode` handler whose `encodings` map contains exactly gzip.
func TestCompile_Compression_GzipOnly(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		Compression: &riokuv1.Compression{
			Enabled:   true,
			Encodings: []string{"gzip"},
		},
	})
	enc := findHandler(chain, "encode")
	if enc == nil {
		t.Fatal("encode handler missing from chain")
	}
	encs := enc["encodings"].(map[string]any)
	if _, ok := encs["gzip"]; !ok {
		t.Error("encodings missing gzip")
	}
	if _, ok := encs["zstd"]; ok {
		t.Error("encodings should not contain zstd when only gzip configured")
	}
}

// TestCompile_Compression_ZstdOnly verifies that Compression with only zstd
// produces an `encode` handler whose `encodings` map contains exactly zstd.
func TestCompile_Compression_ZstdOnly(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		Compression: &riokuv1.Compression{
			Enabled:   true,
			Encodings: []string{"zstd"},
		},
	})
	enc := findHandler(chain, "encode")
	if enc == nil {
		t.Fatal("encode handler missing from chain")
	}
	encs := enc["encodings"].(map[string]any)
	if _, ok := encs["zstd"]; !ok {
		t.Error("encodings missing zstd")
	}
	if _, ok := encs["gzip"]; ok {
		t.Error("encodings should not contain gzip when only zstd configured")
	}
}

// TestCompile_Compression_DefaultMinLength verifies that Compression with
// MinLength=0 falls back to the documented default of 1024 bytes.
func TestCompile_Compression_DefaultMinLength(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		Compression: &riokuv1.Compression{
			Enabled:   true,
			Encodings: []string{"gzip"},
			MinLength: 0,
		},
	})
	enc := findHandler(chain, "encode")
	if enc == nil {
		t.Fatal("encode handler missing from chain")
	}
	if enc["minimum_length"].(float64) != 1024 {
		t.Errorf("minimum_length = %v, want 1024 (default)", enc["minimum_length"])
	}
}

// TestCompile_Compression_NilOmits verifies that a Service with
// Compression=nil produces no `encode` handler.
func TestCompile_Compression_NilOmits(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:          "svc1",
		Upstreams:   []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		Compression: nil,
	})
	if h := findHandler(chain, "encode"); h != nil {
		t.Errorf("encode handler must not appear when Compression is nil; got %v", h)
	}
}

// TestCompile_Compression_EnabledNoEncodingsOmits verifies that Compression
// with Enabled=true but an empty Encodings list produces no `encode`
// handler — there is nothing to compress with.
func TestCompile_Compression_EnabledNoEncodingsOmits(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		Compression: &riokuv1.Compression{
			Enabled:   true,
			Encodings: nil,
		},
	})
	if h := findHandler(chain, "encode"); h != nil {
		t.Errorf("encode handler must not appear when Encodings is empty; got %v", h)
	}
}

// TestCompile_ResponseRules_RouteTo verifies that a ResponseRule with a
// RouteTo action emits a `vars` handler carrying the rioku_route_to_id
// dispatch hint for the daemon.
func TestCompile_ResponseRules_RouteTo(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"401"},
				Action:           &riokuv1.ResponseRule_RouteTo{RouteTo: "auth-route"},
			},
		},
	})
	rp := chain[len(chain)-1]
	hrArr := rp["handle_response"].([]any)
	hr := hrArr[0].(map[string]any)

	routes := hr["routes"].([]any)
	handle := routes[0].(map[string]any)["handle"].([]any)
	vh := handle[0].(map[string]any)
	if vh["handler"] != "vars" {
		t.Errorf("handler = %v, want vars", vh["handler"])
	}
	if vh["rioku_route_to_id"] != "auth-route" {
		t.Errorf("rioku_route_to_id = %v, want auth-route", vh["rioku_route_to_id"])
	}
}

// TestCompile_ResponseRules_4xxWildcard verifies that "4xx" expands to all
// 100 codes in the 400-499 range and is routed through the configured rewrite.
func TestCompile_ResponseRules_4xxWildcard(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"4xx"},
				Action: &riokuv1.ResponseRule_Rewrite{
					Rewrite: &riokuv1.ResponseRewrite{Uri: "/notfound"},
				},
			},
		},
	})
	rp := chain[len(chain)-1]
	hr := rp["handle_response"].([]any)[0].(map[string]any)
	codes := hr["match"].(map[string]any)["status_code"].([]any)
	if len(codes) != 100 {
		t.Fatalf("expanded 4xx should produce 100 codes, got %d", len(codes))
	}
	if int(codes[0].(float64)) != 400 {
		t.Errorf("codes[0] = %v, want 400", codes[0])
	}
	if int(codes[99].(float64)) != 499 {
		t.Errorf("codes[99] = %v, want 499", codes[99])
	}
}

// TestCompile_ResponseRules_Multiple verifies that two ResponseRules produce
// two entries in the handle_response array, in order.
func TestCompile_ResponseRules_Multiple(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"502"},
				Action: &riokuv1.ResponseRule_ServeErrorPage{
					ServeErrorPage: &riokuv1.ResponseErrorPage{StatusCode: 502, Body: "bad gateway"},
				},
			},
			{
				MatchStatusCodes: []string{"503"},
				Action: &riokuv1.ResponseRule_ServeErrorPage{
					ServeErrorPage: &riokuv1.ResponseErrorPage{StatusCode: 503, Body: "unavailable"},
				},
			},
		},
	})
	rp := chain[len(chain)-1]
	hrArr := rp["handle_response"].([]any)
	if len(hrArr) != 2 {
		t.Fatalf("handle_response len = %d, want 2", len(hrArr))
	}
	first := hrArr[0].(map[string]any)
	firstCodes := first["match"].(map[string]any)["status_code"].([]any)
	if int(firstCodes[0].(float64)) != 502 {
		t.Errorf("first rule code = %v, want 502", firstCodes[0])
	}
	second := hrArr[1].(map[string]any)
	secondCodes := second["match"].(map[string]any)["status_code"].([]any)
	if int(secondCodes[0].(float64)) != 503 {
		t.Errorf("second rule code = %v, want 503", secondCodes[0])
	}
}

// TestCompile_ResponseRules_EmptyMatchSkipped verifies that a ResponseRule
// with no match_status_codes is silently dropped (not emitted into
// handle_response). The remaining rule must still appear.
func TestCompile_ResponseRules_EmptyMatchSkipped(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: nil, // skipped
				Action: &riokuv1.ResponseRule_Rewrite{
					Rewrite: &riokuv1.ResponseRewrite{Uri: "/never"},
				},
			},
			{
				MatchStatusCodes: []string{"500"},
				Action: &riokuv1.ResponseRule_Rewrite{
					Rewrite: &riokuv1.ResponseRewrite{Uri: "/error"},
				},
			},
		},
	})
	rp := chain[len(chain)-1]
	hrArr := rp["handle_response"].([]any)
	if len(hrArr) != 1 {
		t.Fatalf("handle_response len = %d, want 1 (empty-match rule dropped)", len(hrArr))
	}
	hr := hrArr[0].(map[string]any)
	codes := hr["match"].(map[string]any)["status_code"].([]any)
	if int(codes[0].(float64)) != 500 {
		t.Errorf("code = %v, want 500", codes[0])
	}
}

// TestCompile_ResponseRules_NoActionSkipped verifies that a ResponseRule with
// no action variant set is silently dropped (the oneof is unset, so the
// switch in buildHandleResponse falls through default).
func TestCompile_ResponseRules_NoActionSkipped(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"500"},
				Action:           nil, // dropped
			},
			{
				MatchStatusCodes: []string{"502"},
				Action: &riokuv1.ResponseRule_Rewrite{
					Rewrite: &riokuv1.ResponseRewrite{Uri: "/recover"},
				},
			},
		},
	})
	rp := chain[len(chain)-1]
	hrArr := rp["handle_response"].([]any)
	if len(hrArr) != 1 {
		t.Fatalf("handle_response len = %d, want 1 (no-action rule dropped)", len(hrArr))
	}
	hr := hrArr[0].(map[string]any)
	codes := hr["match"].(map[string]any)["status_code"].([]any)
	if int(codes[0].(float64)) != 502 {
		t.Errorf("code = %v, want 502", codes[0])
	}
}

// TestCompile_ResponseRules_RewriteWithMethod verifies that a Rewrite action
// carrying both method and uri emits both fields on the rewrite handler.
func TestCompile_ResponseRules_RewriteWithMethod(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"503"},
				Action: &riokuv1.ResponseRule_Rewrite{
					Rewrite: &riokuv1.ResponseRewrite{Method: "GET", Uri: "/maintenance"},
				},
			},
		},
	})
	rp := chain[len(chain)-1]
	hr := rp["handle_response"].([]any)[0].(map[string]any)
	rw := hr["routes"].([]any)[0].(map[string]any)["handle"].([]any)[0].(map[string]any)
	if rw["method"] != "GET" {
		t.Errorf("rewrite.method = %v, want GET", rw["method"])
	}
	if rw["uri"] != "/maintenance" {
		t.Errorf("rewrite.uri = %v, want /maintenance", rw["uri"])
	}
}

// TestCompile_ResponseRules_ServeErrorPageDefaults verifies that a
// ServeErrorPage with status_code=0 and content_type="" falls back to
// the documented defaults (502, text/html; charset=utf-8).
func TestCompile_ResponseRules_ServeErrorPageDefaults(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id:        "svc1",
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"500"},
				Action: &riokuv1.ResponseRule_ServeErrorPage{
					ServeErrorPage: &riokuv1.ResponseErrorPage{
						Body: "oops",
					},
				},
			},
		},
	})
	rp := chain[len(chain)-1]
	hr := rp["handle_response"].([]any)[0].(map[string]any)
	sr := hr["routes"].([]any)[0].(map[string]any)["handle"].([]any)[0].(map[string]any)
	if int(sr["status_code"].(float64)) != 502 {
		t.Errorf("status_code = %v, want 502 (default)", sr["status_code"])
	}
	hdrs := sr["headers"].(map[string]any)
	ct := hdrs["Content-Type"].([]any)
	if len(ct) != 1 || ct[0].(string) != "text/html; charset=utf-8" {
		t.Errorf("Content-Type = %v, want default text/html; charset=utf-8", ct)
	}
}

// TestCompile_DynamicUpstream_A_DefaultRefresh verifies that a zero
// RefreshSeconds on ALookup falls back to the 60s default.
func TestCompile_DynamicUpstream_A_DefaultRefresh(t *testing.T) {
	chain := compileServiceSnap(t, &riokuv1.Service{
		Id: "svc1",
		Upstreams: []*riokuv1.Upstream{
			{
				Source: &riokuv1.Upstream_ALookup{
					ALookup: &riokuv1.ALookup{
						Name:           "api.example.com",
						Port:           443,
						RefreshSeconds: 0, // → default 60s
					},
				},
			},
		},
	})
	rp := chain[len(chain)-1]
	dyn := rp["dynamic_upstreams"].(map[string]any)
	wantRefresh := float64(60 * 1_000_000_000)
	if dyn["refresh"] != wantRefresh {
		t.Errorf("dynamic_upstreams.refresh = %v, want %v (default 60s)", dyn["refresh"], wantRefresh)
	}
	if dyn["port"] != "443" {
		t.Errorf("dynamic_upstreams.port = %v, want \"443\" (string)", dyn["port"])
	}
}

// TestCompile_TrustedProxies_CloudflareDefaultRefresh verifies that a
// dynamic Cloudflare entry with RefreshSeconds=0 falls back to 3600s, formatted
// as a Caddy duration string ("3600s").
func TestCompile_TrustedProxies_CloudflareDefaultRefresh(t *testing.T) {
	tp := &TrustedProxiesConfig{
		Dynamic: []TrustedProxiesDynamicConfig{
			{Strategy: "cloudflare", RefreshSeconds: 0},
		},
	}
	block, ok := buildTrustedProxiesBlock(tp).(map[string]any)
	if !ok {
		t.Fatal("expected non-nil map block for cloudflare-only dynamic config")
	}
	if block["source"] != "cloudflare" {
		t.Errorf("source = %v, want cloudflare", block["source"])
	}
	if block["refresh"] != "3600s" {
		t.Errorf("refresh = %v, want \"3600s\" (default)", block["refresh"])
	}
}

// TestCompile_TrustedProxies_CloudflareCustomRefresh verifies that a
// cloudflare entry with RefreshSeconds set emits the custom value in
// "<n>s" form.
func TestCompile_TrustedProxies_CloudflareCustomRefresh(t *testing.T) {
	tp := &TrustedProxiesConfig{
		Dynamic: []TrustedProxiesDynamicConfig{
			{Strategy: "cloudflare", RefreshSeconds: 1800},
		},
	}
	block := buildTrustedProxiesBlock(tp).(map[string]any)
	if block["refresh"] != "1800s" {
		t.Errorf("refresh = %v, want \"1800s\"", block["refresh"])
	}
}

// TestCompile_TrustedProxies_StaticURLStrategy verifies that the "static"
// (URL-refresh) dynamic strategy emits a static block plus the informational
// _strategy_url and _strategy_refresh keys for future module support.
func TestCompile_TrustedProxies_StaticURLStrategy(t *testing.T) {
	tp := &TrustedProxiesConfig{
		Ranges: []string{"10.0.0.0/8"},
		Dynamic: []TrustedProxiesDynamicConfig{
			{
				Strategy:       "static",
				URL:            "https://example.com/cidrs.json",
				RefreshSeconds: 600,
			},
		},
	}
	block := buildTrustedProxiesBlock(tp).(map[string]any)
	if block["source"] != "static" {
		t.Errorf("source = %v, want static", block["source"])
	}
	if block["_strategy_url"] != "https://example.com/cidrs.json" {
		t.Errorf("_strategy_url = %v, want example.com URL", block["_strategy_url"])
	}
	if block["_strategy_refresh"] != "600s" {
		t.Errorf("_strategy_refresh = %v, want \"600s\"", block["_strategy_refresh"])
	}
	ranges := block["ranges"].([]string)
	if len(ranges) != 1 || ranges[0] != "10.0.0.0/8" {
		t.Errorf("ranges = %v, want [10.0.0.0/8]", ranges)
	}
}

// TestCompile_TrustedProxies_StaticURLStrategy_DefaultRefresh verifies that
// the "static" URL-refresh strategy with RefreshSeconds=0 falls back to 3600s.
func TestCompile_TrustedProxies_StaticURLStrategy_DefaultRefresh(t *testing.T) {
	tp := &TrustedProxiesConfig{
		Dynamic: []TrustedProxiesDynamicConfig{
			{Strategy: "static", URL: "https://example.com/cidrs.json", RefreshSeconds: 0},
		},
	}
	block := buildTrustedProxiesBlock(tp).(map[string]any)
	if block["_strategy_refresh"] != "3600s" {
		t.Errorf("_strategy_refresh = %v, want \"3600s\" (default)", block["_strategy_refresh"])
	}
}

// TestCompile_TrustedProxies_DynamicOnlyNoStaticRanges verifies that a
// dynamic-only config (no Ranges) with cloudflare strategy emits the
// cloudflare block without a static-ranges fallback.
func TestCompile_TrustedProxies_DynamicOnlyNoStaticRanges(t *testing.T) {
	tp := &TrustedProxiesConfig{
		Dynamic: []TrustedProxiesDynamicConfig{
			{Strategy: "cloudflare", RefreshSeconds: 7200},
		},
	}
	block := buildTrustedProxiesBlock(tp).(map[string]any)
	if block["source"] != "cloudflare" {
		t.Errorf("source = %v, want cloudflare", block["source"])
	}
	// Cloudflare module manages its own list — no `ranges` should be forwarded.
	if _, has := block["ranges"]; has {
		t.Error("cloudflare block must not carry a ranges field")
	}
}

// TestCompile_TrustedProxies_MultipleDynamicEmitsFirst verifies that when
// multiple dynamic strategies are configured, only the first is emitted
// (Caddy accepts a single IP-source module per server). This documents the
// best-effort mapping noted in compiler_upstreams.go.
func TestCompile_TrustedProxies_MultipleDynamicEmitsFirst(t *testing.T) {
	tp := &TrustedProxiesConfig{
		Dynamic: []TrustedProxiesDynamicConfig{
			{Strategy: "cloudflare", RefreshSeconds: 1800},
			{Strategy: "static", URL: "https://other.example.com/cidrs.json", RefreshSeconds: 600},
		},
	}
	block := buildTrustedProxiesBlock(tp).(map[string]any)
	if block["source"] != "cloudflare" {
		t.Errorf("source = %v, want cloudflare (first dynamic entry); got %v", block["source"], block)
	}
	// The second strategy's URL must NOT appear in the emitted block.
	if v, has := block["_strategy_url"]; has {
		t.Errorf("_strategy_url = %v, want absent (second dynamic ignored)", v)
	}
}

// TestCompile_TrustedProxies_UnknownStrategyFallsBackToStatic verifies that
// an unknown dynamic strategy name (one Caddy doesn't have a module for)
// falls through the switch default and emits a "static" block with the
// known ranges plus informational fields.
func TestCompile_TrustedProxies_UnknownStrategyFallsBackToStatic(t *testing.T) {
	tp := &TrustedProxiesConfig{
		Ranges: []string{"172.16.0.0/12"},
		Dynamic: []TrustedProxiesDynamicConfig{
			{Strategy: "fastly", URL: "https://api.fastly.com/public-ip-list", RefreshSeconds: 900},
		},
	}
	block := buildTrustedProxiesBlock(tp).(map[string]any)
	if block["source"] != "static" {
		t.Errorf("source = %v, want static (unknown strategy falls back)", block["source"])
	}
	ranges := block["ranges"].([]string)
	if len(ranges) != 1 || ranges[0] != "172.16.0.0/12" {
		t.Errorf("ranges = %v, want [172.16.0.0/12]", ranges)
	}
	if block["_strategy_url"] != "https://api.fastly.com/public-ip-list" {
		t.Errorf("_strategy_url = %v, want fastly URL", block["_strategy_url"])
	}
}
