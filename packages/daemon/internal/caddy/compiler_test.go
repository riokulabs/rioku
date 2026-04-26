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

	encoder := logging["encoder"].(map[string]any)
	if encoder["format"].(string) != "json" {
		t.Errorf("encoder.format = %v, want json", encoder["format"])
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
