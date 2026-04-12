package config

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/store"

	// Register the sqlite driver.
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// --------------------------------------------------------------------------
// Test helper
// --------------------------------------------------------------------------

// newTestEngine creates a config.Engine backed by an in-memory-like SQLite
// store (temp dir) with migrations applied and a Caddy compiler configured
// for localhost:8080. The store and engine are cleaned up when the test ends.
func newTestEngine(t *testing.T) *Engine {
	t.Helper()
	ctx := context.Background()

	d, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{}, "", nil)
	return NewEngine(d, compiler)
}

// applyService is a convenience that creates a service via ApplyChange and
// returns the result. It fails the test on error.
func applyService(t *testing.T, eng *Engine, name string, upstreams []*riokuv1.Upstream) *riokuv1.ApplyResult {
	t.Helper()
	ctx := context.Background()
	res, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name:      name,
					Upstreams: upstreams,
					LbPolicy:  riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange service %q: %v", name, err)
	}
	return res
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

func TestApplyServiceChange(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	res := applyService(t, eng, "my-backend", []*riokuv1.Upstream{
		{Address: "127.0.0.1:9001", Weight: 1, Healthy: true},
		{Address: "127.0.0.1:9002", Weight: 2, Healthy: true},
	})

	if res.Meta.ConfigVersion != 1 {
		t.Fatalf("expected config version 1, got %d", res.Meta.ConfigVersion)
	}
	if res.Meta.Actor != "test-actor" {
		t.Fatalf("expected actor test-actor, got %q", res.Meta.Actor)
	}

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(snap.Services))
	}
	svc := snap.Services[0]
	if svc.Name != "my-backend" {
		t.Fatalf("expected service name my-backend, got %q", svc.Name)
	}
	if len(svc.Upstreams) != 2 {
		t.Fatalf("expected 2 upstreams, got %d", len(svc.Upstreams))
	}
}

func TestApplyRouteChange(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service first so we can reference it.
	applyService(t, eng, "backend-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create a route pointing to the service.
	res, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "api-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{
							Hosts: []string{"api.example.com"},
							Paths: []*riokuv1.PathMatcher{
								{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/api"},
							},
						},
					},
					Target: &riokuv1.Route_ServiceId{ServiceId: svcID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route: %v", err)
	}
	if res.Meta.ConfigVersion != 2 {
		t.Fatalf("expected config version 2, got %d", res.Meta.ConfigVersion)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(snap.Routes))
	}
	route := snap.Routes[0]
	if route.Name != "api-route" {
		t.Fatalf("expected route name api-route, got %q", route.Name)
	}
	if route.GetServiceId() != svcID {
		t.Fatalf("expected service_id %q, got %q", svcID, route.GetServiceId())
	}
	if !route.Enabled {
		t.Fatal("expected route to be enabled")
	}
}

func TestApplyPolicyChange(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	cfg, err := structpb.NewStruct(map[string]any{
		"requests_per_second": 100,
		"burst":               10,
	})
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}

	res, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name:   "rate-limit-policy",
					Type:   riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
					Config: cfg,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy: %v", err)
	}
	if res.Meta.ConfigVersion != 1 {
		t.Fatalf("expected config version 1, got %d", res.Meta.ConfigVersion)
	}

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Policies) != 1 {
		t.Fatalf("expected 1 policy, got %d", len(snap.Policies))
	}
	pol := snap.Policies[0]
	if pol.Name != "rate-limit-policy" {
		t.Fatalf("expected policy name rate-limit-policy, got %q", pol.Name)
	}
	if pol.Type != riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT {
		t.Fatalf("expected RATE_LIMIT type, got %v", pol.Type)
	}
}

func TestApplyDeleteChange(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service.
	applyService(t, eng, "delete-me", []*riokuv1.Upstream{
		{Address: "127.0.0.1:3000", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(snap.Services))
	}
	svcID := snap.Services[0].Id

	// Delete the service.
	res, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_DELETE,
				Id:     svcID,
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange delete: %v", err)
	}
	if res.Meta.ConfigVersion != 2 {
		t.Fatalf("expected config version 2, got %d", res.Meta.ConfigVersion)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Services) != 0 {
		t.Fatalf("expected 0 services after delete, got %d", len(snap.Services))
	}
}

func TestOptimisticLocking(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service so there is version 1.
	applyService(t, eng, "locking-test", []*riokuv1.Upstream{
		{Address: "127.0.0.1:5000", Weight: 1, Healthy: true},
	})

	// Try to apply with expected_version = 99 (wrong).
	_, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name: "should-fail",
					Upstreams: []*riokuv1.Upstream{
						{Address: "127.0.0.1:5001", Weight: 1, Healthy: true},
					},
				},
			},
		},
		ExpectedVersion: 99,
	}, "test-actor")
	if err == nil {
		t.Fatal("expected version conflict error, got nil")
	}
	if !strings.Contains(err.Error(), "version conflict") {
		t.Fatalf("expected version conflict error, got: %v", err)
	}

	// Apply with correct expected_version = 1.
	res, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name: "should-succeed",
					Upstreams: []*riokuv1.Upstream{
						{Address: "127.0.0.1:5002", Weight: 1, Healthy: true},
					},
				},
			},
		},
		ExpectedVersion: 1,
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange with correct version: %v", err)
	}
	if res.Meta.ConfigVersion != 2 {
		t.Fatalf("expected config version 2, got %d", res.Meta.ConfigVersion)
	}
}

func TestValidation(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	tests := []struct {
		name   string
		change *riokuv1.ConfigChange
		errMsg string
	}{
		{
			name: "route missing name",
			change: &riokuv1.ConfigChange{
				Operation: &riokuv1.ConfigChange_Route{
					Route: &riokuv1.RouteOp{
						Action: riokuv1.RouteOp_UPSERT,
						Route: &riokuv1.Route{
							Matchers: []*riokuv1.Matcher{{Hosts: []string{"example.com"}}},
							Target:   &riokuv1.Route_ServiceId{ServiceId: "svc-1"},
						},
					},
				},
			},
			errMsg: "route name is required",
		},
		{
			name: "route missing matchers",
			change: &riokuv1.ConfigChange{
				Operation: &riokuv1.ConfigChange_Route{
					Route: &riokuv1.RouteOp{
						Action: riokuv1.RouteOp_UPSERT,
						Route: &riokuv1.Route{
							Name:   "no-matchers",
							Target: &riokuv1.Route_ServiceId{ServiceId: "svc-1"},
						},
					},
				},
			},
			errMsg: "at least one matcher",
		},
		{
			name: "route missing target",
			change: &riokuv1.ConfigChange{
				Operation: &riokuv1.ConfigChange_Route{
					Route: &riokuv1.RouteOp{
						Action: riokuv1.RouteOp_UPSERT,
						Route: &riokuv1.Route{
							Name:     "no-target",
							Matchers: []*riokuv1.Matcher{{Hosts: []string{"example.com"}}},
						},
					},
				},
			},
			errMsg: "service_id or an upstream target",
		},
		{
			name: "route delete missing id",
			change: &riokuv1.ConfigChange{
				Operation: &riokuv1.ConfigChange_Route{
					Route: &riokuv1.RouteOp{
						Action: riokuv1.RouteOp_DELETE,
					},
				},
			},
			errMsg: "id is required for route delete",
		},
		{
			name: "service missing name",
			change: &riokuv1.ConfigChange{
				Operation: &riokuv1.ConfigChange_Service{
					Service: &riokuv1.ServiceOp{
						Action:  riokuv1.ServiceOp_UPSERT,
						Service: &riokuv1.Service{},
					},
				},
			},
			errMsg: "service name is required",
		},
		{
			name: "service delete missing id",
			change: &riokuv1.ConfigChange{
				Operation: &riokuv1.ConfigChange_Service{
					Service: &riokuv1.ServiceOp{
						Action: riokuv1.ServiceOp_DELETE,
					},
				},
			},
			errMsg: "id is required for service delete",
		},
		{
			name: "policy missing name",
			change: &riokuv1.ConfigChange{
				Operation: &riokuv1.ConfigChange_Policy{
					Policy: &riokuv1.PolicyOp{
						Action: riokuv1.PolicyOp_UPSERT,
						Policy: &riokuv1.Policy{
							Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
						},
					},
				},
			},
			errMsg: "policy name is required",
		},
		{
			name: "policy missing type",
			change: &riokuv1.ConfigChange{
				Operation: &riokuv1.ConfigChange_Policy{
					Policy: &riokuv1.PolicyOp{
						Action: riokuv1.PolicyOp_UPSERT,
						Policy: &riokuv1.Policy{
							Name: "missing-type",
						},
					},
				},
			},
			errMsg: "policy type must be specified",
		},
		{
			name: "policy delete missing id",
			change: &riokuv1.ConfigChange{
				Operation: &riokuv1.ConfigChange_Policy{
					Policy: &riokuv1.PolicyOp{
						Action: riokuv1.PolicyOp_DELETE,
					},
				},
			},
			errMsg: "id is required for policy delete",
		},
		{
			name:   "nil change",
			change: nil,
			errMsg: "change is nil",
		},
		{
			name:   "empty change",
			change: &riokuv1.ConfigChange{},
			errMsg: "operation is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := eng.ApplyChange(ctx, tt.change, "test-actor")
			if err == nil {
				t.Fatal("expected validation error, got nil")
			}
			if !strings.Contains(err.Error(), tt.errMsg) {
				t.Fatalf("expected error containing %q, got: %v", tt.errMsg, err)
			}
		})
	}
}

func TestAuditLog(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create two services.
	applyService(t, eng, "svc-1", []*riokuv1.Upstream{
		{Address: "127.0.0.1:4001", Weight: 1, Healthy: true},
	})
	applyService(t, eng, "svc-2", []*riokuv1.Upstream{
		{Address: "127.0.0.1:4002", Weight: 1, Healthy: true},
	})

	// Query full audit log.
	entries, err := eng.GetAuditLog(ctx, store.AuditQuery{Limit: 100})
	if err != nil {
		t.Fatalf("GetAuditLog: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 audit entries, got %d", len(entries))
	}

	// Entries are ordered by occurred_at DESC, so the most recent comes first.
	// The second service (svc-2) was created last and has config_version 2.
	first := entries[0]
	if first.Actor != "test-actor" {
		t.Fatalf("expected actor test-actor, got %q", first.Actor)
	}
	if first.EntityType != "service" {
		t.Fatalf("expected entity_type service, got %q", first.EntityType)
	}
	if first.Operation != "CREATE" {
		t.Fatalf("expected operation CREATE, got %q", first.Operation)
	}
	if first.ConfigVersion != 2 {
		t.Fatalf("expected config_version 2, got %d", first.ConfigVersion)
	}

	// The second entry is for svc-1 with config_version 1.
	second := entries[1]
	if second.ConfigVersion != 1 {
		t.Fatalf("expected config_version 1, got %d", second.ConfigVersion)
	}

	// Query filtered by actor.
	entries, err = eng.GetAuditLog(ctx, store.AuditQuery{
		Actor: "test-actor",
		Limit: 100,
	})
	if err != nil {
		t.Fatalf("GetAuditLog filtered: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 audit entries for test-actor, got %d", len(entries))
	}

	// Query with non-existent actor.
	entries, err = eng.GetAuditLog(ctx, store.AuditQuery{
		Actor: "nobody",
		Limit: 100,
	})
	if err != nil {
		t.Fatalf("GetAuditLog nobody: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected 0 audit entries for nobody, got %d", len(entries))
	}
}

func TestImportExport(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create some entities.
	applyService(t, eng, "svc-export", []*riokuv1.Upstream{
		{Address: "127.0.0.1:6001", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "route-export",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"export.example.com"}},
					},
					Target: &riokuv1.Route_ServiceId{ServiceId: svcID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route: %v", err)
	}

	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "pol-export",
					Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy: %v", err)
	}

	// Export.
	exported, err := eng.ExportConfig(ctx)
	if err != nil {
		t.Fatalf("ExportConfig: %v", err)
	}
	if len(exported.Routes) != 1 {
		t.Fatalf("expected 1 route in export, got %d", len(exported.Routes))
	}
	if len(exported.Services) != 1 {
		t.Fatalf("expected 1 service in export, got %d", len(exported.Services))
	}
	if len(exported.Policies) != 1 {
		t.Fatalf("expected 1 policy in export, got %d", len(exported.Policies))
	}

	// Import into a fresh engine.
	eng2 := newTestEngine(t)

	result, err := eng2.ImportConfig(ctx, exported, "import-actor")
	if err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	if result.RoutesImported != 1 {
		t.Fatalf("expected 1 route imported, got %d", result.RoutesImported)
	}
	if result.ServicesImported != 1 {
		t.Fatalf("expected 1 service imported, got %d", result.ServicesImported)
	}
	if result.PoliciesImported != 1 {
		t.Fatalf("expected 1 policy imported, got %d", result.PoliciesImported)
	}
	if result.Meta.Actor != "import-actor" {
		t.Fatalf("expected actor import-actor, got %q", result.Meta.Actor)
	}

	// Verify round-trip.
	imported, err := eng2.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after import: %v", err)
	}
	if len(imported.Routes) != 1 {
		t.Fatalf("expected 1 route after import, got %d", len(imported.Routes))
	}
	if len(imported.Services) != 1 {
		t.Fatalf("expected 1 service after import, got %d", len(imported.Services))
	}
	if len(imported.Policies) != 1 {
		t.Fatalf("expected 1 policy after import, got %d", len(imported.Policies))
	}

	// Verify entity names survived the round-trip.
	if imported.Services[0].Name != "svc-export" {
		t.Fatalf("expected service name svc-export, got %q", imported.Services[0].Name)
	}
	if imported.Routes[0].Name != "route-export" {
		t.Fatalf("expected route name route-export, got %q", imported.Routes[0].Name)
	}
	if imported.Policies[0].Name != "pol-export" {
		t.Fatalf("expected policy name pol-export, got %q", imported.Policies[0].Name)
	}
}

func TestCompileCaddyConfig(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service and a route.
	applyService(t, eng, "caddy-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:7001", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "caddy-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{
							Hosts: []string{"caddy.example.com"},
							Paths: []*riokuv1.PathMatcher{
								{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/"},
							},
						},
					},
					Target: &riokuv1.Route_ServiceId{ServiceId: svcID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route: %v", err)
	}

	// Compile.
	data, err := eng.CompileCaddyConfig(ctx)
	if err != nil {
		t.Fatalf("CompileCaddyConfig: %v", err)
	}

	// Verify it is valid JSON.
	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("invalid JSON from CompileCaddyConfig: %v", err)
	}

	// Verify structure.
	apps, ok := parsed["apps"].(map[string]any)
	if !ok {
		t.Fatal("expected apps in Caddy config")
	}
	httpApp, ok := apps["http"].(map[string]any)
	if !ok {
		t.Fatal("expected apps.http in Caddy config")
	}
	servers, ok := httpApp["servers"].(map[string]any)
	if !ok {
		t.Fatal("expected apps.http.servers in Caddy config")
	}
	trafficServer, ok := servers["traffic"].(map[string]any)
	if !ok {
		t.Fatal("expected apps.http.servers.traffic in Caddy config")
	}
	routes, ok := trafficServer["routes"].([]any)
	if !ok {
		t.Fatal("expected apps.http.servers.traffic.routes in Caddy config")
	}
	if len(routes) != 1 {
		t.Fatalf("expected 1 compiled route, got %d", len(routes))
	}

	// Verify the route has a reverse_proxy handler (may be preceded by rioku_vars).
	routeMap, ok := routes[0].(map[string]any)
	if !ok {
		t.Fatal("expected route to be a map")
	}
	handlers, ok := routeMap["handle"].([]any)
	if !ok || len(handlers) == 0 {
		t.Fatal("expected at least one handler")
	}
	foundProxy := false
	for _, h := range handlers {
		hMap, ok := h.(map[string]any)
		if !ok {
			continue
		}
		if hMap["handler"] == "reverse_proxy" {
			foundProxy = true
			break
		}
	}
	if !foundProxy {
		t.Fatalf("expected reverse_proxy handler in route handlers, got %v", handlers)
	}
}

func TestPolicyIdsCreateRoute(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service for the route target.
	applyService(t, eng, "policy-ids-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create two policies.
	cfg1, _ := structpb.NewStruct(map[string]any{"rps": 100})
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name:   "pol-a",
					Type:   riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
					Config: cfg1,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-a: %v", err)
	}

	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "pol-b",
					Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-b: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Policies) != 2 {
		t.Fatalf("expected 2 policies, got %d", len(snap.Policies))
	}
	polAID := snap.Policies[0].Id
	polBID := snap.Policies[1].Id

	// Create a route with policyIds.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "policy-ids-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polAID, polBID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route: %v", err)
	}

	// Read back and verify policyIds.
	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(snap.Routes))
	}
	route := snap.Routes[0]
	if len(route.PolicyIds) != 2 {
		t.Fatalf("expected 2 policyIds on route, got %d: %v", len(route.PolicyIds), route.PolicyIds)
	}

	// Verify both policy IDs are present (order may vary).
	policySet := make(map[string]bool)
	for _, id := range route.PolicyIds {
		policySet[id] = true
	}
	if !policySet[polAID] {
		t.Fatalf("expected polAID %q in policyIds", polAID)
	}
	if !policySet[polBID] {
		t.Fatalf("expected polBID %q in policyIds", polBID)
	}
}

func TestPolicyIdsUpdateRoute(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service.
	applyService(t, eng, "upd-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create two policies.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "upd-pol-a",
					Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-a: %v", err)
	}
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "upd-pol-b",
					Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-b: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	polAID := snap.Policies[0].Id
	polBID := snap.Policies[1].Id

	// Create route with polA only.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "upd-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polAID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange create route: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	routeID := snap.Routes[0].Id
	if len(snap.Routes[0].PolicyIds) != 1 {
		t.Fatalf("expected 1 policyId after create, got %d", len(snap.Routes[0].PolicyIds))
	}

	// Update: replace polA with polB.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Id:      routeID,
					Name:    "upd-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polBID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange update route: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Routes[0].PolicyIds) != 1 {
		t.Fatalf("expected 1 policyId after update, got %d", len(snap.Routes[0].PolicyIds))
	}
	if snap.Routes[0].PolicyIds[0] != polBID {
		t.Fatalf("expected policyId %q, got %q", polBID, snap.Routes[0].PolicyIds[0])
	}
}

func TestPolicyIdsRemoveAll(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service.
	applyService(t, eng, "rm-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create a policy.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "rm-pol",
					Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	polID := snap.Policies[0].Id

	// Create route with policy.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "rm-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange create route: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	routeID := snap.Routes[0].Id
	if len(snap.Routes[0].PolicyIds) != 1 {
		t.Fatalf("expected 1 policyId, got %d", len(snap.Routes[0].PolicyIds))
	}

	// Update route with empty policyIds.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Id:      routeID,
					Name:    "rm-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: nil,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange update route empty policies: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(snap.Routes[0].PolicyIds) != 0 {
		t.Fatalf("expected 0 policyIds after removal, got %d: %v", len(snap.Routes[0].PolicyIds), snap.Routes[0].PolicyIds)
	}
}

func TestImportConfigPolicyIdRemapping(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create entities in the source engine.
	applyService(t, eng, "import-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create two policies.
	cfg1, _ := structpb.NewStruct(map[string]any{"rps": 50})
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name:   "import-pol-a",
					Type:   riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
					Config: cfg1,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-a: %v", err)
	}

	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: "import-pol-b",
					Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy-b: %v", err)
	}

	// Create a route with no policyIds initially.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    "import-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"import.example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route: %v", err)
	}

	// Manually get the policy IDs and attach them to the route.
	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	polAID := ""
	polBID := ""
	for _, p := range snap.Policies {
		if p.Name == "import-pol-a" {
			polAID = p.Id
		}
		if p.Name == "import-pol-b" {
			polBID = p.Id
		}
	}

	routeID := snap.Routes[0].Id
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Id:      routeID,
					Name:    "import-route",
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"import.example.com"}},
					},
					Target:    &riokuv1.Route_ServiceId{ServiceId: svcID},
					PolicyIds: []string{polAID, polBID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange update route with policies: %v", err)
	}

	// Export the snapshot.
	exported, err := eng.ExportConfig(ctx)
	if err != nil {
		t.Fatalf("ExportConfig: %v", err)
	}

	// Verify the exported snapshot has policyIds.
	if len(exported.Routes) != 1 {
		t.Fatalf("expected 1 route in export, got %d", len(exported.Routes))
	}
	if len(exported.Routes[0].PolicyIds) != 2 {
		t.Fatalf("expected 2 policyIds in exported route, got %d", len(exported.Routes[0].PolicyIds))
	}

	// Import into a fresh engine.
	eng2 := newTestEngine(t)

	result, err := eng2.ImportConfig(ctx, exported, "import-actor")
	if err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	if result.RoutesImported != 1 {
		t.Fatalf("expected 1 route imported, got %d", result.RoutesImported)
	}
	if result.ServicesImported != 1 {
		t.Fatalf("expected 1 service imported, got %d", result.ServicesImported)
	}
	if result.PoliciesImported != 2 {
		t.Fatalf("expected 2 policies imported, got %d", result.PoliciesImported)
	}

	// Verify imported config has policyIds on the route.
	imported, err := eng2.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after import: %v", err)
	}
	if len(imported.Routes) != 1 {
		t.Fatalf("expected 1 route after import, got %d", len(imported.Routes))
	}
	if len(imported.Routes[0].PolicyIds) != 2 {
		t.Fatalf("expected 2 policyIds after import, got %d: %v", len(imported.Routes[0].PolicyIds), imported.Routes[0].PolicyIds)
	}

	// Verify the imported policyIds reference the NEW policy IDs (not old ones).
	importedPolIDs := make(map[string]bool)
	for _, p := range imported.Policies {
		importedPolIDs[p.Id] = true
	}
	for _, pid := range imported.Routes[0].PolicyIds {
		if !importedPolIDs[pid] {
			t.Fatalf("imported route policyId %q does not reference an imported policy", pid)
		}
	}

	// Verify names survived.
	polNames := make(map[string]bool)
	for _, p := range imported.Policies {
		polNames[p.Name] = true
	}
	if !polNames["import-pol-a"] {
		t.Fatal("expected import-pol-a in imported policies")
	}
	if !polNames["import-pol-b"] {
		t.Fatal("expected import-pol-b in imported policies")
	}
}
