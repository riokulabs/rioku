package caddy

import (
	"encoding/json"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

func TestCompileSimpleRoute(t *testing.T) {
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443", ":80"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	}, "", nil)

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
	}, "", nil)

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
	}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, socketPath, nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	}, "", tp)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)

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
		c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil)
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
