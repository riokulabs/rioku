package caddy

import (
	"fmt"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// generateSnapshot creates a ConfigSnapshot with n routes and n/5 services.
func generateSnapshot(n int) *riokuv1.ConfigSnapshot {
	numServices := n / 5
	if numServices < 1 {
		numServices = 1
	}

	services := make([]*riokuv1.Service, numServices)
	for i := 0; i < numServices; i++ {
		svcID := fmt.Sprintf("svc-%d", i)
		services[i] = &riokuv1.Service{
			Id:   svcID,
			Name: fmt.Sprintf("service-%d", i),
			Upstreams: []*riokuv1.Upstream{
				{Address: fmt.Sprintf("127.0.0.1:%d", 9000+i)},
				{Address: fmt.Sprintf("127.0.0.1:%d", 10000+i)},
			},
			LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
			HealthCheck: &riokuv1.HealthCheck{
				Enabled:         true,
				Path:            "/healthz",
				IntervalSeconds: 10,
				TimeoutSeconds:  5,
			},
		}
	}

	routes := make([]*riokuv1.Route, n)
	for i := 0; i < n; i++ {
		svcIdx := i % numServices
		routes[i] = &riokuv1.Route{
			Id:      fmt.Sprintf("route-%d", i),
			Name:    fmt.Sprintf("route-%d", i),
			Enabled: true,
			Matchers: []*riokuv1.Matcher{
				{
					Hosts: []string{fmt.Sprintf("app%d.example.com", i)},
					Paths: []*riokuv1.PathMatcher{
						{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/api/*"},
					},
					Methods: []string{"GET", "POST"},
				},
			},
			Target: &riokuv1.Route_ServiceId{
				ServiceId: fmt.Sprintf("svc-%d", svcIdx),
			},
		}
	}

	return &riokuv1.ConfigSnapshot{
		Version:  1,
		Routes:   routes,
		Services: services,
	}
}

func BenchmarkCompile(b *testing.B) {
	for _, n := range []int{10, 100, 1000} {
		b.Run(fmt.Sprintf("%d_routes", n), func(b *testing.B) {
			snap := generateSnapshot(n)
			compiler := NewCompiler(
				[]string{":443", ":80"},
				AdminConfig{InternalAddr: "127.0.0.1:54321"},
				"",
			)
			b.ResetTimer()
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				_, err := compiler.Compile(snap)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkCompileRoute(b *testing.B) {
	compiler := NewCompiler([]string{":443"}, AdminConfig{}, "")
	services := map[string]*riokuv1.Service{
		"svc-1": {
			Id:   "svc-1",
			Name: "test-service",
			Upstreams: []*riokuv1.Upstream{
				{Address: "127.0.0.1:9001"},
				{Address: "127.0.0.1:9002", Weight: 3},
			},
			LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_WEIGHTED_ROUND_ROBIN,
		},
	}
	route := &riokuv1.Route{
		Id:      "route-1",
		Name:    "bench-route",
		Enabled: true,
		Matchers: []*riokuv1.Matcher{
			{
				Hosts:   []string{"api.example.com"},
				Paths:   []*riokuv1.PathMatcher{{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/v1/*"}},
				Methods: []string{"GET", "POST", "PUT", "DELETE"},
				Headers: []*riokuv1.HeaderMatcher{{Name: "X-Api-Version", Value: "2"}},
			},
		},
		Target: &riokuv1.Route_ServiceId{ServiceId: "svc-1"},
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, err := compiler.CompileRoute(route, services)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkCompile_WithAdminBlock(b *testing.B) {
	snap := generateSnapshot(100)
	compiler := NewCompiler(
		[]string{":443", ":80"},
		AdminConfig{
			InternalAddr: "127.0.0.1:54321",
			ListenAddr:   ":7778",
			Domain:       "admin.example.com",
		},
		"",
	)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, err := compiler.Compile(snap)
		if err != nil {
			b.Fatal(err)
		}
	}
}
