package config

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	// Register the sqlite driver.
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func benchEngine(b *testing.B) *Engine {
	b.Helper()
	ctx := context.Background()

	d, err := store.New("sqlite")
	if err != nil {
		b.Fatal(err)
	}

	dbPath := filepath.Join(b.TempDir(), "bench.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		b.Fatal(err)
	}
	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = d.Close() })

	compiler := caddy.NewCompiler(
		[]string{":443"},
		caddy.AdminConfig{InternalAddr: "127.0.0.1:54321"},
	)
	return NewEngine(d, compiler)
}

func BenchmarkApplyChange_CreateRoute(b *testing.B) {
	engine := benchEngine(b)
	ctx := context.Background()

	// Pre-create a service to reference.
	svcChange := &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name: "bench-svc",
					Upstreams: []*riokuv1.Upstream{
						{Address: "127.0.0.1:9001"},
					},
				},
			},
		},
	}
	result, err := engine.ApplyChange(ctx, svcChange, "bench")
	if err != nil {
		b.Fatal(err)
	}
	_ = result

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		change := &riokuv1.ConfigChange{
			Operation: &riokuv1.ConfigChange_Route{
				Route: &riokuv1.RouteOp{
					Action: riokuv1.RouteOp_UPSERT,
					Route: &riokuv1.Route{
						Name:    fmt.Sprintf("bench-route-%d", i),
						Enabled: true,
						Matchers: []*riokuv1.Matcher{
							{
								Hosts: []string{fmt.Sprintf("app%d.example.com", i)},
								Paths: []*riokuv1.PathMatcher{
									{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/api/*"},
								},
							},
						},
						Target: &riokuv1.Route_Upstream{
							Upstream: &riokuv1.DirectUpstream{Address: "127.0.0.1:9001"},
						},
					},
				},
			},
		}
		_, err := engine.ApplyChange(ctx, change, "bench")
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkGetConfig(b *testing.B) {
	for _, n := range []int{10, 100, 500} {
		b.Run(fmt.Sprintf("%d_routes", n), func(b *testing.B) {
			engine := benchEngine(b)
			ctx := context.Background()

			// Seed n routes.
			for i := 0; i < n; i++ {
				change := &riokuv1.ConfigChange{
					Operation: &riokuv1.ConfigChange_Route{
						Route: &riokuv1.RouteOp{
							Action: riokuv1.RouteOp_UPSERT,
							Route: &riokuv1.Route{
								Name:    fmt.Sprintf("seed-route-%d", i),
								Enabled: true,
								Matchers: []*riokuv1.Matcher{
									{Hosts: []string{fmt.Sprintf("r%d.example.com", i)}},
								},
								Target: &riokuv1.Route_Upstream{
									Upstream: &riokuv1.DirectUpstream{Address: "127.0.0.1:9001"},
								},
							},
						},
					},
				}
				if _, err := engine.ApplyChange(ctx, change, "seed"); err != nil {
					b.Fatal(err)
				}
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := engine.GetConfig(ctx)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkCompileCaddyConfig(b *testing.B) {
	for _, n := range []int{10, 100, 500} {
		b.Run(fmt.Sprintf("%d_routes", n), func(b *testing.B) {
			engine := benchEngine(b)
			ctx := context.Background()

			for i := 0; i < n; i++ {
				change := &riokuv1.ConfigChange{
					Operation: &riokuv1.ConfigChange_Route{
						Route: &riokuv1.RouteOp{
							Action: riokuv1.RouteOp_UPSERT,
							Route: &riokuv1.Route{
								Name:    fmt.Sprintf("seed-route-%d", i),
								Enabled: true,
								Matchers: []*riokuv1.Matcher{
									{Hosts: []string{fmt.Sprintf("r%d.example.com", i)}},
								},
								Target: &riokuv1.Route_Upstream{
									Upstream: &riokuv1.DirectUpstream{Address: "127.0.0.1:9001"},
								},
							},
						},
					},
				}
				if _, err := engine.ApplyChange(ctx, change, "seed"); err != nil {
					b.Fatal(err)
				}
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := engine.CompileCaddyConfig(ctx)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkImportConfig(b *testing.B) {
	for _, n := range []int{10, 100} {
		b.Run(fmt.Sprintf("%d_entities", n), func(b *testing.B) {
			engine := benchEngine(b)
			ctx := context.Background()

			numServices := n / 5
			if numServices < 1 {
				numServices = 1
			}
			services := make([]*riokuv1.Service, numServices)
			for i := range services {
				services[i] = &riokuv1.Service{
					Id:   fmt.Sprintf("import-svc-%d", i),
					Name: fmt.Sprintf("import-svc-%d", i),
					Upstreams: []*riokuv1.Upstream{
						{Address: fmt.Sprintf("127.0.0.1:%d", 9000+i)},
					},
				}
			}
			routes := make([]*riokuv1.Route, n)
			for i := range routes {
				routes[i] = &riokuv1.Route{
					Name:    fmt.Sprintf("import-route-%d", i),
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{fmt.Sprintf("import%d.example.com", i)}},
					},
					Target: &riokuv1.Route_Upstream{
						Upstream: &riokuv1.DirectUpstream{Address: "127.0.0.1:9001"},
					},
				}
			}
			snap := &riokuv1.ConfigSnapshot{
				Routes:   routes,
				Services: services,
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := engine.ImportConfig(ctx, snap, "bench")
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
