package config

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/store"
)

// --------------------------------------------------------------------------
// SetCompiler
// --------------------------------------------------------------------------

// TestSetCompiler verifies that SetCompiler replaces the compiler and the new
// compiler is used by subsequent CompileCaddyConfig calls.
func TestSetCompiler(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Replace the compiler with a new one — we just verify no panic / error.
	newCompiler := caddy.NewCompiler([]string{":9999"}, caddy.AdminConfig{}, "", nil)
	eng.SetCompiler(newCompiler)

	// CompileCaddyConfig should use the new compiler without error.
	data, err := eng.CompileCaddyConfig(ctx)
	if err != nil {
		t.Fatalf("CompileCaddyConfig after SetCompiler: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("invalid JSON after SetCompiler: %v", err)
	}
}

// --------------------------------------------------------------------------
// applyRouteOp — exercised through ApplyChange
// --------------------------------------------------------------------------

// applyRoute is a convenience helper that creates a route via ApplyChange and
// returns the result. It fails the test on error.
func applyRoute(t *testing.T, eng *Engine, name, host, svcID string) *riokuv1.ApplyResult {
	t.Helper()
	ctx := context.Background()
	res, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Name:    name,
					Enabled: true,
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{host}},
					},
					Target: &riokuv1.Route_ServiceId{ServiceId: svcID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route %q: %v", name, err)
	}
	return res
}

// applyPolicy is a convenience helper that creates a policy via ApplyChange.
func applyPolicy(t *testing.T, eng *Engine, name string, polType riokuv1.PolicyType) *riokuv1.ApplyResult {
	t.Helper()
	ctx := context.Background()
	res, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Name: name,
					Type: polType,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy %q: %v", name, err)
	}
	return res
}

func TestApplyRouteOp_Create(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Need a service to reference.
	applyService(t, eng, "route-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8001", Weight: 1, Healthy: true},
	})
	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	res := applyRoute(t, eng, "create-route", "create.example.com", svcID)
	if res.Meta.ConfigVersion < 1 {
		t.Fatalf("expected non-zero config version, got %d", res.Meta.ConfigVersion)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after create: %v", err)
	}
	if len(snap.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(snap.Routes))
	}
	if snap.Routes[0].Name != "create-route" {
		t.Fatalf("expected route name create-route, got %q", snap.Routes[0].Name)
	}
}

func TestApplyRouteOp_Update(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	applyService(t, eng, "update-route-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8002", Weight: 1, Healthy: true},
	})
	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	// Create the route first.
	applyRoute(t, eng, "update-route", "update.example.com", svcID)

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after create: %v", err)
	}
	routeID := snap.Routes[0].Id

	// Update the route — reuse ID so it goes through the update branch.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_UPSERT,
				Route: &riokuv1.Route{
					Id:      routeID,
					Name:    "update-route",
					Enabled: false, // toggled from true
					Matchers: []*riokuv1.Matcher{
						{Hosts: []string{"updated.example.com"}},
					},
					Target: &riokuv1.Route_ServiceId{ServiceId: svcID},
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route update: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after update: %v", err)
	}
	if len(snap.Routes) != 1 {
		t.Fatalf("expected 1 route after update, got %d", len(snap.Routes))
	}
	if snap.Routes[0].Enabled {
		t.Fatal("expected route to be disabled after update")
	}
}

func TestApplyRouteOp_Delete(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	applyService(t, eng, "delete-route-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8003", Weight: 1, Healthy: true},
	})
	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	applyRoute(t, eng, "delete-route", "delete.example.com", svcID)

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after create: %v", err)
	}
	routeID := snap.Routes[0].Id

	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Route{
			Route: &riokuv1.RouteOp{
				Action: riokuv1.RouteOp_DELETE,
				Id:     routeID,
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange route delete: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after delete: %v", err)
	}
	if len(snap.Routes) != 0 {
		t.Fatalf("expected 0 routes after delete, got %d", len(snap.Routes))
	}
}

// --------------------------------------------------------------------------
// applyServiceOp — update branch
// --------------------------------------------------------------------------

func TestApplyServiceOp_Update(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service.
	applyService(t, eng, "update-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:8100", Weight: 1, Healthy: true},
	})

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after create: %v", err)
	}
	svcID := snap.Services[0].Id

	// Update: change upstreams via UPSERT with the existing ID.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Id:   svcID,
					Name: "update-svc",
					Upstreams: []*riokuv1.Upstream{
						{Address: "127.0.0.1:8101", Weight: 2, Healthy: true},
						{Address: "127.0.0.1:8102", Weight: 2, Healthy: true},
					},
					LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange service update: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after update: %v", err)
	}
	if len(snap.Services) != 1 {
		t.Fatalf("expected 1 service after update, got %d", len(snap.Services))
	}
	if len(snap.Services[0].Upstreams) != 2 {
		t.Fatalf("expected 2 upstreams after update, got %d", len(snap.Services[0].Upstreams))
	}
}

// --------------------------------------------------------------------------
// applyPolicyOp — exercised through ApplyChange
// --------------------------------------------------------------------------

func TestApplyPolicyOp_Create(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	res := applyPolicy(t, eng, "create-pol", riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT)
	if res.Meta.ConfigVersion < 1 {
		t.Fatalf("expected non-zero config version, got %d", res.Meta.ConfigVersion)
	}

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after create: %v", err)
	}
	if len(snap.Policies) != 1 {
		t.Fatalf("expected 1 policy, got %d", len(snap.Policies))
	}
	if snap.Policies[0].Name != "create-pol" {
		t.Fatalf("expected policy name create-pol, got %q", snap.Policies[0].Name)
	}
}

func TestApplyPolicyOp_Update(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	applyPolicy(t, eng, "update-pol", riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT)

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after create: %v", err)
	}
	polID := snap.Policies[0].Id

	// Update: change type, keep same ID.
	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_UPSERT,
				Policy: &riokuv1.Policy{
					Id:   polID,
					Name: "update-pol",
					Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
				},
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy update: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after update: %v", err)
	}
	if len(snap.Policies) != 1 {
		t.Fatalf("expected 1 policy after update, got %d", len(snap.Policies))
	}
	if snap.Policies[0].Type != riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT {
		t.Fatalf("expected AUTH_JWT type after update, got %v", snap.Policies[0].Type)
	}
}

func TestApplyPolicyOp_Delete(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	applyPolicy(t, eng, "delete-pol", riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT)

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after create: %v", err)
	}
	polID := snap.Policies[0].Id

	_, err = eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Policy{
			Policy: &riokuv1.PolicyOp{
				Action: riokuv1.PolicyOp_DELETE,
				Id:     polID,
			},
		},
	}, "test-actor")
	if err != nil {
		t.Fatalf("ApplyChange policy delete: %v", err)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after delete: %v", err)
	}
	if len(snap.Policies) != 0 {
		t.Fatalf("expected 0 policies after delete, got %d", len(snap.Policies))
	}
}

// --------------------------------------------------------------------------
// ApplyChange error paths
// --------------------------------------------------------------------------

func TestApplyChange_VersionConflict(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// No versions yet; expected_version=5 should conflict with current=0.
	_, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name: "conflict-svc",
					Upstreams: []*riokuv1.Upstream{
						{Address: "127.0.0.1:9000", Weight: 1, Healthy: true},
					},
				},
			},
		},
		ExpectedVersion: 5,
	}, "test-actor")
	if err == nil {
		t.Fatal("expected version conflict error, got nil")
	}
	if !strings.Contains(err.Error(), "version conflict") {
		t.Fatalf("expected 'version conflict' in error, got: %v", err)
	}
}

func TestApplyChange_UnknownOperationType(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// A ConfigChange with no operation set hits the default case.
	// The nil-operation change will fail validation ("operation is required") before
	// reaching the switch, so we verify the validation error is returned.
	_, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{}, "test-actor")
	if err == nil {
		t.Fatal("expected error for empty ConfigChange, got nil")
	}
	if !strings.Contains(err.Error(), "operation is required") {
		t.Fatalf("expected 'operation is required' in error, got: %v", err)
	}
}

// --------------------------------------------------------------------------
// deleteAll (exercised via ImportConfig)
// --------------------------------------------------------------------------

func TestDeleteAll(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Seed data: one service, one route (referencing the service), and one policy
	// so that the route-deletion loop inside deleteAll is exercised.
	applyService(t, eng, "del-all-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:7100", Weight: 1, Healthy: true},
	})
	snapBefore, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig for svc ID: %v", err)
	}
	svcID := snapBefore.Services[0].Id
	applyRoute(t, eng, "del-all-route", "del-all.example.com", svcID)
	applyPolicy(t, eng, "del-all-pol", riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT)

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig before import: %v", err)
	}
	if len(snap.Routes) != 1 || len(snap.Services) != 1 || len(snap.Policies) != 1 {
		t.Fatalf("expected 1 route, 1 service and 1 policy before import, got %d/%d/%d",
			len(snap.Routes), len(snap.Services), len(snap.Policies))
	}

	// ImportConfig with an empty snapshot triggers deleteAll and removes
	// all existing entities.
	result, err := eng.ImportConfig(ctx, &riokuv1.ConfigSnapshot{}, "del-actor")
	if err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	if result.RoutesImported != 0 || result.ServicesImported != 0 || result.PoliciesImported != 0 {
		t.Fatalf("expected 0 imported entities, got routes=%d svc=%d pol=%d",
			result.RoutesImported, result.ServicesImported, result.PoliciesImported)
	}

	snap, err = eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig after import: %v", err)
	}
	if len(snap.Routes) != 0 {
		t.Fatalf("expected 0 routes after deleteAll, got %d", len(snap.Routes))
	}
	if len(snap.Services) != 0 {
		t.Fatalf("expected 0 services after deleteAll, got %d", len(snap.Services))
	}
	if len(snap.Policies) != 0 {
		t.Fatalf("expected 0 policies after deleteAll, got %d", len(snap.Policies))
	}
}

// --------------------------------------------------------------------------
// ExportConfig
// --------------------------------------------------------------------------

func TestExportConfig(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	applyService(t, eng, "export-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:7200", Weight: 1, Healthy: true},
	})
	applyPolicy(t, eng, "export-pol", riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT)

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	svcID := snap.Services[0].Id

	applyRoute(t, eng, "export-route", "export.example.com", svcID)

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
	if exported.Services[0].Name != "export-svc" {
		t.Fatalf("expected service name export-svc, got %q", exported.Services[0].Name)
	}
	if exported.Routes[0].Name != "export-route" {
		t.Fatalf("expected route name export-route, got %q", exported.Routes[0].Name)
	}
	if exported.Policies[0].Name != "export-pol" {
		t.Fatalf("expected policy name export-pol, got %q", exported.Policies[0].Name)
	}
	if exported.Version < 1 {
		t.Fatalf("expected version >= 1 in export, got %d", exported.Version)
	}
}

// --------------------------------------------------------------------------
// CompileCaddyConfig (additional coverage — empty snapshot path)
// --------------------------------------------------------------------------

func TestCompileCaddyConfig_EmptySnapshot(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// With no routes/services the compiler should still return valid JSON.
	data, err := eng.CompileCaddyConfig(ctx)
	if err != nil {
		t.Fatalf("CompileCaddyConfig empty: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("invalid JSON from CompileCaddyConfig (empty): %v", err)
	}
}

// --------------------------------------------------------------------------
// WatchChanges — basic path (nil Notify backend closes channel immediately)
// --------------------------------------------------------------------------

func TestWatchChanges_NoNotifyBackend(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// The sqlite driver returns a non-nil notify channel, so the goroutine
	// stays alive. Cancel the context to tear it down immediately.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	ch, err := eng.WatchChanges(ctx, 0)
	if err != nil {
		t.Fatalf("WatchChanges: %v", err)
	}
	// Cancel context so the goroutine closes the channel.
	cancel()

	// Drain until closed.
	for range ch {
	}
}

func TestWatchChanges_SinceVersion(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	// Create a service so there is a config version > 0.
	applyService(t, eng, "watch-svc", []*riokuv1.Upstream{
		{Address: "127.0.0.1:7300", Weight: 1, Healthy: true},
	})

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// sinceVersion > 0 triggers a SNAPSHOT event before switching to live.
	ch, err := eng.WatchChanges(ctx, 1)
	if err != nil {
		t.Fatalf("WatchChanges: %v", err)
	}

	// First event must be a SNAPSHOT.
	evt, ok := <-ch
	if !ok {
		t.Fatal("expected a SNAPSHOT event, channel closed immediately")
	}
	if evt.Type != riokuv1.ConfigEvent_TYPE_SNAPSHOT {
		t.Fatalf("expected TYPE_SNAPSHOT, got %v", evt.Type)
	}
	if evt.Snapshot == nil {
		t.Fatal("expected non-nil snapshot in SNAPSHOT event")
	}

	// Cancel so the goroutine exits cleanly.
	cancel()
	for range ch {
	}
}

// --------------------------------------------------------------------------
// translateChangeEvent — direct unit tests
// --------------------------------------------------------------------------

func TestTranslateChangeEvent(t *testing.T) {
	tests := []struct {
		table     string
		operation string
		wantType  riokuv1.ConfigEvent_Type
	}{
		{"routes", "INSERT", riokuv1.ConfigEvent_TYPE_ROUTE_UPSERTED},
		{"routes", "UPDATE", riokuv1.ConfigEvent_TYPE_ROUTE_UPSERTED},
		{"routes", "DELETE", riokuv1.ConfigEvent_TYPE_ROUTE_DELETED},
		{"services", "INSERT", riokuv1.ConfigEvent_TYPE_SERVICE_UPSERTED},
		{"services", "UPDATE", riokuv1.ConfigEvent_TYPE_SERVICE_UPSERTED},
		{"services", "DELETE", riokuv1.ConfigEvent_TYPE_SERVICE_DELETED},
		{"policies", "INSERT", riokuv1.ConfigEvent_TYPE_POLICY_UPSERTED},
		{"policies", "UPDATE", riokuv1.ConfigEvent_TYPE_POLICY_UPSERTED},
		{"policies", "DELETE", riokuv1.ConfigEvent_TYPE_POLICY_DELETED},
		{"unknown_table", "INSERT", riokuv1.ConfigEvent_TYPE_UNSPECIFIED},
	}

	for _, tt := range tests {
		t.Run(tt.table+"/"+tt.operation, func(t *testing.T) {
			ce := store.ChangeEvent{
				Table:     tt.table,
				Operation: tt.operation,
				RowID:     "row-1",
			}
			evt := translateChangeEvent(ce)
			if evt == nil {
				t.Fatal("expected non-nil ConfigEvent")
			}
			if evt.Type != tt.wantType {
				t.Fatalf("expected event type %v, got %v", tt.wantType, evt.Type)
			}
			if evt.OccurredAt == nil {
				t.Fatal("expected OccurredAt to be set")
			}
		})
	}
}

// --------------------------------------------------------------------------
// buildSnapshot — additional path: version is 0 on empty DB
// --------------------------------------------------------------------------

func TestBuildSnapshot_EmptyDB(t *testing.T) {
	eng := newTestEngine(t)
	ctx := context.Background()

	snap, err := eng.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig on empty DB: %v", err)
	}
	if snap.Version != 0 {
		t.Fatalf("expected version 0 on empty DB, got %d", snap.Version)
	}
	if len(snap.Routes) != 0 || len(snap.Services) != 0 || len(snap.Policies) != 0 {
		t.Fatal("expected empty snapshot on empty DB")
	}
}
