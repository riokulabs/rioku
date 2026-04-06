package caddy

import (
	"encoding/json"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

func TestCompileSimpleRoute(t *testing.T) {
	c := NewCompiler(":443", ":80")

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
	server := dig(t, cfg, "apps", "http", "servers", "rioku")
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

	// Check handler.
	handlers := route["handle"].([]any)
	if len(handlers) != 1 {
		t.Fatalf("expected 1 handler, got %d", len(handlers))
	}
	h := handlers[0].(map[string]any)
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
	c := NewCompiler(":443")

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

	server := dig(t, cfg, "apps", "http", "servers", "rioku")
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
	c := NewCompiler(":443")

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

	server := dig(t, cfg, "apps", "http", "servers", "rioku")
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
	c := NewCompiler(":443")

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

	server := dig(t, cfg, "apps", "http", "servers", "rioku")
	routes := server["routes"].([]any)
	if len(routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(routes))
	}

	handler := routes[0].(map[string]any)["handle"].([]any)[0].(map[string]any)
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
	c := NewCompiler(":443", ":80")

	snapshot := &riokuv1.ConfigSnapshot{}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	server := dig(t, cfg, "apps", "http", "servers", "rioku")
	routes := server["routes"].([]any)
	if len(routes) != 0 {
		t.Fatalf("expected 0 routes, got %d", len(routes))
	}
}

func TestMatcherTypes(t *testing.T) {
	c := NewCompiler(":443")

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

			server := dig(t, cfg, "apps", "http", "servers", "rioku")
			routes := server["routes"].([]any)
			route := routes[0].(map[string]any)
			matchSets := route["match"].([]any)
			ms := matchSets[0].(map[string]any)

			tt.check(t, ms)
		})
	}
}

func TestCompileServiceNotFound(t *testing.T) {
	c := NewCompiler(":443")

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
	c := NewCompiler(":443")

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

	server := dig(t, cfg, "apps", "http", "servers", "rioku")
	route := server["routes"].([]any)[0].(map[string]any)
	handler := route["handle"].([]any)[0].(map[string]any)
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
