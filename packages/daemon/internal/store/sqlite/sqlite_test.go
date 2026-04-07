package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
)

// openTestDB creates a new driver with a temp SQLite database and runs
// migrations. It registers a cleanup function to close the driver.
func openTestDB(t *testing.T) *driver {
	t.Helper()
	ctx := context.Background()

	d := &driver{}
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { d.Close() })

	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return d
}

func TestOpen(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	if err := d.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	v, err := d.CurrentVersion(ctx)
	if err != nil {
		t.Fatalf("CurrentVersion: %v", err)
	}
	if v != 2 {
		t.Fatalf("expected version 2, got %d", v)
	}

	h := d.Health(ctx)
	if !h.OK {
		t.Fatal("expected Health.OK to be true")
	}
	if h.Mode != store.ModeSingle {
		t.Fatalf("expected ModeSingle, got %v", h.Mode)
	}
}

func TestRouteCRUD(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// First create a service to reference from the route.
	txS, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svc, err := txS.CreateService(ctx, &riokuv1.Service{
		Name:     "backend-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := txS.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Create route.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	created, err := tx1.CreateRoute(ctx, &riokuv1.Route{
		Name: "test-route",
		Matchers: []*riokuv1.Matcher{
			{
				Hosts:   []string{"example.com"},
				Methods: []string{"GET", "POST"},
				Paths: []*riokuv1.PathMatcher{
					{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/api"},
				},
			},
		},
		Target:  &riokuv1.Route_ServiceId{ServiceId: svc.GetId()},
		Enabled: true,
		Labels:  &riokuv1.Labels{Labels: map[string]string{"env": "test"}},
	})
	if err != nil {
		t.Fatalf("CreateRoute: %v", err)
	}
	if created.GetId() == "" {
		t.Fatal("expected non-empty route ID")
	}
	if created.GetName() != "test-route" {
		t.Fatalf("expected name 'test-route', got %q", created.GetName())
	}
	if !created.GetEnabled() {
		t.Fatal("expected enabled=true")
	}
	if created.GetCreatedAt() == nil {
		t.Fatal("expected non-nil CreatedAt")
	}
	if created.GetServiceId() != svc.GetId() {
		t.Fatalf("expected service_id=%q, got %q", svc.GetId(), created.GetServiceId())
	}
	if len(created.GetMatchers()) != 1 {
		t.Fatalf("expected 1 matcher, got %d", len(created.GetMatchers()))
	}
	if created.GetMatchers()[0].GetHosts()[0] != "example.com" {
		t.Fatalf("expected host 'example.com', got %q", created.GetMatchers()[0].GetHosts()[0])
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get route.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetRoute(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetRoute: %v", err)
	}
	if got.GetName() != "test-route" {
		t.Fatalf("GetRoute: expected name 'test-route', got %q", got.GetName())
	}
	tx2.Rollback()

	// List routes.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	routes, err := tx3.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("ListRoutes: %v", err)
	}
	if len(routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(routes))
	}
	tx3.Rollback()

	// Update route.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created.Name = "updated-route"
	created.Enabled = false
	updated, err := tx4.UpdateRoute(ctx, created)
	if err != nil {
		t.Fatalf("UpdateRoute: %v", err)
	}
	if updated.GetName() != "updated-route" {
		t.Fatalf("expected name 'updated-route', got %q", updated.GetName())
	}
	if updated.GetEnabled() {
		t.Fatal("expected enabled=false")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Delete route.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteRoute(ctx, created.GetId()); err != nil {
		t.Fatalf("DeleteRoute: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify deletion.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	routes, err = tx6.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("ListRoutes: %v", err)
	}
	if len(routes) != 0 {
		t.Fatalf("expected 0 routes after delete, got %d", len(routes))
	}
	tx6.Rollback()
}

func TestServiceCRUD(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:     "my-service",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_LEAST_CONN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:80", Weight: 3, Tls: riokuv1.TLSMode_TLS_MODE_AUTO, Healthy: true},
			{Address: "10.0.0.2:80", Weight: 1, Healthy: false, DialErr: "connection refused"},
		},
		HealthCheck: &riokuv1.HealthCheck{
			Enabled:         true,
			Path:            "/health",
			IntervalSeconds: 10,
			TimeoutSeconds:  5,
		},
		Labels: &riokuv1.Labels{Labels: map[string]string{"tier": "frontend"}},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if created.GetId() == "" {
		t.Fatal("expected non-empty service ID")
	}
	if len(created.GetUpstreams()) != 2 {
		t.Fatalf("expected 2 upstreams, got %d", len(created.GetUpstreams()))
	}
	if created.GetHealthCheck() == nil {
		t.Fatal("expected non-nil HealthCheck")
	}
	if created.GetHealthCheck().GetPath() != "/health" {
		t.Fatalf("expected health_check.path='/health', got %q", created.GetHealthCheck().GetPath())
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get with upstreams.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetService(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if len(got.GetUpstreams()) != 2 {
		t.Fatalf("GetService: expected 2 upstreams, got %d", len(got.GetUpstreams()))
	}
	// Verify upstream fields.
	found := false
	for _, u := range got.GetUpstreams() {
		if u.GetAddress() == "10.0.0.1:80" {
			found = true
			if u.GetWeight() != 3 {
				t.Fatalf("expected weight=3, got %d", u.GetWeight())
			}
			if u.GetTls() != riokuv1.TLSMode_TLS_MODE_AUTO {
				t.Fatalf("expected tls=AUTO, got %v", u.GetTls())
			}
		}
	}
	if !found {
		t.Fatal("upstream 10.0.0.1:80 not found")
	}
	tx2.Rollback()

	// List.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	services, err := tx3.ListServices(ctx)
	if err != nil {
		t.Fatalf("ListServices: %v", err)
	}
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	tx3.Rollback()

	// Update.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created.Name = "updated-service"
	created.Upstreams = []*riokuv1.Upstream{
		{Address: "10.0.0.3:80", Weight: 5, Healthy: true},
	}
	updated, err := tx4.UpdateService(ctx, created)
	if err != nil {
		t.Fatalf("UpdateService: %v", err)
	}
	if updated.GetName() != "updated-service" {
		t.Fatalf("expected name='updated-service', got %q", updated.GetName())
	}
	if len(updated.GetUpstreams()) != 1 {
		t.Fatalf("expected 1 upstream after update, got %d", len(updated.GetUpstreams()))
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Delete.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteService(ctx, created.GetId()); err != nil {
		t.Fatalf("DeleteService: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

func TestPolicyCRUD(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	cfg, err := structpb.NewStruct(map[string]any{
		"requests_per_second": 100,
		"burst":               10,
	})
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}

	// Create.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreatePolicy(ctx, &riokuv1.Policy{
		Name:   "rate-limit-policy",
		Type:   riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
		Config: cfg,
		Labels: &riokuv1.Labels{Labels: map[string]string{"scope": "global"}},
	})
	if err != nil {
		t.Fatalf("CreatePolicy: %v", err)
	}
	if created.GetId() == "" {
		t.Fatal("expected non-empty policy ID")
	}
	if created.GetType() != riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT {
		t.Fatalf("expected type RATE_LIMIT, got %v", created.GetType())
	}
	if created.GetConfig() == nil {
		t.Fatal("expected non-nil config")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetPolicy(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetPolicy: %v", err)
	}
	if got.GetName() != "rate-limit-policy" {
		t.Fatalf("expected name 'rate-limit-policy', got %q", got.GetName())
	}
	rps := got.GetConfig().GetFields()["requests_per_second"].GetNumberValue()
	if rps != 100 {
		t.Fatalf("expected requests_per_second=100, got %v", rps)
	}
	tx2.Rollback()

	// List.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	policies, err := tx3.ListPolicies(ctx)
	if err != nil {
		t.Fatalf("ListPolicies: %v", err)
	}
	if len(policies) != 1 {
		t.Fatalf("expected 1 policy, got %d", len(policies))
	}
	tx3.Rollback()

	// Update.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created.Name = "updated-rate-limit"
	updated, err := tx4.UpdatePolicy(ctx, created)
	if err != nil {
		t.Fatalf("UpdatePolicy: %v", err)
	}
	if updated.GetName() != "updated-rate-limit" {
		t.Fatalf("expected name 'updated-rate-limit', got %q", updated.GetName())
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Attach / detach bindings.
	// Create a service to bind to.
	txS, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svc, err := txS.CreateService(ctx, &riokuv1.Service{
		Name:     "bind-target-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:9090", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := txS.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.AttachPolicy(ctx, created.GetId(), "service", svc.GetId()); err != nil {
		t.Fatalf("AttachPolicy: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	policyIDs, err := tx6.ListPoliciesByTarget(ctx, "service", svc.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(policyIDs) != 1 || policyIDs[0] != created.GetId() {
		t.Fatalf("expected [%s], got %v", created.GetId(), policyIDs)
	}
	tx6.Rollback()

	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DetachPolicy(ctx, created.GetId(), "service", svc.GetId()); err != nil {
		t.Fatalf("DetachPolicy: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx8, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	policyIDs, err = tx8.ListPoliciesByTarget(ctx, "service", svc.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(policyIDs) != 0 {
		t.Fatalf("expected 0 policy IDs after detach, got %d", len(policyIDs))
	}
	tx8.Rollback()

	// Delete.
	tx9, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx9.DeletePolicy(ctx, created.GetId()); err != nil {
		t.Fatalf("DeletePolicy: %v", err)
	}
	if err := tx9.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

func TestAPIKeyCRUD(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	expires := time.Now().Add(24 * time.Hour).UTC().Truncate(time.Millisecond)

	// Create.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	id, err := tx1.CreateAPIKey(ctx, "my-key", "sha256:abc123", []string{"read", "write"}, &expires)
	if err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty key ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	key, err := tx2.GetAPIKey(ctx, id)
	if err != nil {
		t.Fatalf("GetAPIKey: %v", err)
	}
	if key.Name != "my-key" {
		t.Fatalf("expected name='my-key', got %q", key.Name)
	}
	if key.KeyHash != "sha256:abc123" {
		t.Fatalf("expected key_hash='sha256:abc123', got %q", key.KeyHash)
	}
	if len(key.Scopes) != 2 {
		t.Fatalf("expected 2 scopes, got %d", len(key.Scopes))
	}
	if key.RevokedAt != nil {
		t.Fatal("expected nil RevokedAt")
	}
	tx2.Rollback()

	// Get by hash.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	key2, err := tx3.GetAPIKeyByHash(ctx, "sha256:abc123")
	if err != nil {
		t.Fatalf("GetAPIKeyByHash: %v", err)
	}
	if key2.ID != id {
		t.Fatalf("expected ID=%q, got %q", id, key2.ID)
	}
	tx3.Rollback()

	// List (should only return non-revoked).
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	keys, err := tx4.ListAPIKeys(ctx)
	if err != nil {
		t.Fatalf("ListAPIKeys: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("expected 1 key, got %d", len(keys))
	}
	tx4.Rollback()

	// Revoke.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.RevokeAPIKey(ctx, id); err != nil {
		t.Fatalf("RevokeAPIKey: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify revocation: list should be empty.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	keys, err = tx6.ListAPIKeys(ctx)
	if err != nil {
		t.Fatalf("ListAPIKeys: %v", err)
	}
	if len(keys) != 0 {
		t.Fatalf("expected 0 keys after revoke, got %d", len(keys))
	}
	tx6.Rollback()

	// Get by ID should still return the revoked key.
	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	revoked, err := tx7.GetAPIKey(ctx, id)
	if err != nil {
		t.Fatalf("GetAPIKey after revoke: %v", err)
	}
	if revoked.RevokedAt == nil {
		t.Fatal("expected non-nil RevokedAt after revoke")
	}
	tx7.Rollback()
}

func TestAuditLog(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	now := time.Now().UTC()

	// Append entries.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	for i, e := range []*riokuv1.AuditEntry{
		{
			Actor:         "admin",
			EntityType:    "route",
			EntityId:      "route-1",
			Operation:     "CREATE",
			Diff:          `{"name":"added"}`,
			ConfigVersion: 1,
			OccurredAt:    timestamppb.New(now.Add(-2 * time.Hour)),
		},
		{
			Actor:         "admin",
			EntityType:    "service",
			EntityId:      "svc-1",
			Operation:     "CREATE",
			Diff:          `{"name":"added"}`,
			ConfigVersion: 1,
			OccurredAt:    timestamppb.New(now.Add(-1 * time.Hour)),
		},
		{
			Actor:         "bot",
			EntityType:    "route",
			EntityId:      "route-1",
			Operation:     "UPDATE",
			Diff:          `{"name":"changed"}`,
			ConfigVersion: 2,
			OccurredAt:    timestamppb.New(now),
		},
	} {
		if err := tx1.AppendAuditEntry(ctx, e); err != nil {
			t.Fatalf("AppendAuditEntry[%d]: %v", i, err)
		}
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Query all.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	all, err := tx2.QueryAuditLog(ctx, store.AuditQuery{Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(all))
	}
	// Should be ordered by occurred_at DESC.
	if all[0].GetOperation() != "UPDATE" {
		t.Fatalf("expected first entry to be UPDATE, got %q", all[0].GetOperation())
	}
	tx2.Rollback()

	// Query by actor.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	adminEntries, err := tx3.QueryAuditLog(ctx, store.AuditQuery{Actor: "admin", Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog(actor=admin): %v", err)
	}
	if len(adminEntries) != 2 {
		t.Fatalf("expected 2 admin entries, got %d", len(adminEntries))
	}
	tx3.Rollback()

	// Query by entity_type.
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	routeEntries, err := tx4.QueryAuditLog(ctx, store.AuditQuery{EntityType: "route", Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog(entity_type=route): %v", err)
	}
	if len(routeEntries) != 2 {
		t.Fatalf("expected 2 route entries, got %d", len(routeEntries))
	}
	tx4.Rollback()

	// Query by entity_id.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svcEntries, err := tx5.QueryAuditLog(ctx, store.AuditQuery{EntityID: "svc-1", Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog(entity_id=svc-1): %v", err)
	}
	if len(svcEntries) != 1 {
		t.Fatalf("expected 1 svc-1 entry, got %d", len(svcEntries))
	}
	tx5.Rollback()

	// Query with time range.
	since := now.Add(-90 * time.Minute)
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	recentEntries, err := tx6.QueryAuditLog(ctx, store.AuditQuery{Since: &since, Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog(since): %v", err)
	}
	if len(recentEntries) != 2 {
		t.Fatalf("expected 2 recent entries, got %d", len(recentEntries))
	}
	tx6.Rollback()
}

func TestConfigVersions(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Save versions.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	v1, err := tx1.SaveConfigVersion(ctx, []byte(`{"routes":[]}`), "admin")
	if err != nil {
		t.Fatalf("SaveConfigVersion: %v", err)
	}
	if v1 != 1 {
		t.Fatalf("expected version 1, got %d", v1)
	}

	v2, err := tx1.SaveConfigVersion(ctx, []byte(`{"routes":[{"name":"r1"}]}`), "admin")
	if err != nil {
		t.Fatalf("SaveConfigVersion: %v", err)
	}
	if v2 != 2 {
		t.Fatalf("expected version 2, got %d", v2)
	}

	v3, err := tx1.SaveConfigVersion(ctx, []byte(`{"routes":[{"name":"r1"},{"name":"r2"}]}`), "bot")
	if err != nil {
		t.Fatalf("SaveConfigVersion: %v", err)
	}
	if v3 != 3 {
		t.Fatalf("expected version 3, got %d", v3)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	cv, err := tx2.GetConfigVersion(ctx, 2)
	if err != nil {
		t.Fatalf("GetConfigVersion: %v", err)
	}
	if cv.Version != 2 {
		t.Fatalf("expected version 2, got %d", cv.Version)
	}
	if cv.Actor != "admin" {
		t.Fatalf("expected actor 'admin', got %q", cv.Actor)
	}
	if string(cv.Snapshot) != `{"routes":[{"name":"r1"}]}` {
		t.Fatalf("unexpected snapshot: %s", string(cv.Snapshot))
	}
	tx2.Rollback()

	// List.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	versions, err := tx3.ListConfigVersions(ctx, 2)
	if err != nil {
		t.Fatalf("ListConfigVersions: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("expected 2 versions, got %d", len(versions))
	}
	// Should be descending.
	if versions[0].Version != 3 {
		t.Fatalf("expected first version=3, got %d", versions[0].Version)
	}
	if versions[1].Version != 2 {
		t.Fatalf("expected second version=2, got %d", versions[1].Version)
	}
	tx3.Rollback()

	// Latest.
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	latest, err := tx4.LatestConfigVersion(ctx)
	if err != nil {
		t.Fatalf("LatestConfigVersion: %v", err)
	}
	if latest != 3 {
		t.Fatalf("expected latest=3, got %d", latest)
	}
	tx4.Rollback()
}

func TestNotify(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	ch := d.Notify()
	if ch == nil {
		t.Fatal("expected non-nil notify channel")
	}

	// Perform a mutation.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx1.CreateService(ctx, &riokuv1.Service{
		Name:     "notify-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// We should have received at least one event.
	select {
	case ev := <-ch:
		if ev.Table != "services" {
			t.Fatalf("expected table='services', got %q", ev.Table)
		}
		if ev.Operation != "INSERT" {
			t.Fatalf("expected operation='INSERT', got %q", ev.Operation)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for notify event")
	}
}

func TestMigrateDown(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Running down should drop all tables.
	if err := d.Migrate(ctx, store.MigrateDown); err != nil {
		t.Fatalf("MigrateDown: %v", err)
	}

	// After down, we should not be able to query routes.
	_, err := d.db.ExecContext(ctx, "SELECT 1 FROM routes")
	if err == nil {
		t.Fatal("expected error querying routes after migrate down")
	}
}

func TestRouteWithDirectUpstream(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateRoute(ctx, &riokuv1.Route{
		Name: "direct-route",
		Matchers: []*riokuv1.Matcher{
			{Hosts: []string{"direct.example.com"}},
		},
		Target: &riokuv1.Route_Upstream{
			Upstream: &riokuv1.DirectUpstream{
				Address: "upstream.example.com:443",
				Tls:     riokuv1.TLSMode_TLS_MODE_AUTO,
			},
		},
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateRoute: %v", err)
	}
	if created.GetUpstream() == nil {
		t.Fatal("expected non-nil DirectUpstream")
	}
	if created.GetUpstream().GetAddress() != "upstream.example.com:443" {
		t.Fatalf("expected address='upstream.example.com:443', got %q", created.GetUpstream().GetAddress())
	}
	if created.GetUpstream().GetTls() != riokuv1.TLSMode_TLS_MODE_AUTO {
		t.Fatalf("expected tls=AUTO, got %v", created.GetUpstream().GetTls())
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

// createTestUser is a helper that creates a user inside a committed transaction
// and returns the persisted user.
func createTestUser(t *testing.T, d *driver, username string) *store.User {
	t.Helper()
	ctx := context.Background()

	email := username + "@example.com"
	displayName := "Test " + username

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	u, err := tx1.CreateUser(ctx, &store.User{
		Username:     username,
		Email:        &email,
		DisplayName:  &displayName,
		PasswordHash: "$argon2id$v=19$hash",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	return u
}

func TestUserCRUD(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	email := "admin@example.com"
	displayName := "Admin User"
	totpSecret := "JBSWY3DPEHPK3PXP"

	tests := []struct {
		name string
		fn   func(t *testing.T)
	}{
		{
			name: "create and get by ID",
			fn: func(t *testing.T) {
				tx1, err := d.Begin(ctx, store.TxOptions{})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				created, err := tx1.CreateUser(ctx, &store.User{
					Username:            "Admin",
					Email:               &email,
					DisplayName:         &displayName,
					PasswordHash:        "$argon2id$v=19$hash",
					Status:              "active",
					TOTPSecret:          &totpSecret,
					TOTPEnabled:         true,
					ForcePasswordChange: true,
				})
				if err != nil {
					t.Fatalf("CreateUser: %v", err)
				}
				if created.ID == "" {
					t.Fatal("expected non-empty user ID")
				}
				// Username should be stored lowercase.
				if created.Username != "admin" {
					t.Fatalf("expected username 'admin', got %q", created.Username)
				}
				if created.Email == nil || *created.Email != email {
					t.Fatalf("expected email %q, got %v", email, created.Email)
				}
				if created.DisplayName == nil || *created.DisplayName != displayName {
					t.Fatalf("expected display_name %q, got %v", displayName, created.DisplayName)
				}
				if created.Status != "active" {
					t.Fatalf("expected status 'active', got %q", created.Status)
				}
				if created.TOTPSecret == nil || *created.TOTPSecret != totpSecret {
					t.Fatalf("expected totp_secret %q, got %v", totpSecret, created.TOTPSecret)
				}
				if !created.TOTPEnabled {
					t.Fatal("expected totp_enabled=true")
				}
				if !created.ForcePasswordChange {
					t.Fatal("expected force_password_change=true")
				}
				if created.CreatedAt.IsZero() {
					t.Fatal("expected non-zero CreatedAt")
				}
				if err := tx1.Commit(); err != nil {
					t.Fatalf("Commit: %v", err)
				}

				// Get by ID.
				tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				got, err := tx2.GetUser(ctx, created.ID)
				if err != nil {
					t.Fatalf("GetUser: %v", err)
				}
				if got.Username != "admin" {
					t.Fatalf("GetUser: expected username 'admin', got %q", got.Username)
				}
				if got.PasswordHash != "$argon2id$v=19$hash" {
					t.Fatalf("GetUser: unexpected password_hash %q", got.PasswordHash)
				}
				tx2.Rollback()
			},
		},
		{
			name: "get by username case-insensitive",
			fn: func(t *testing.T) {
				tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				got, err := tx1.GetUserByUsername(ctx, "ADMIN")
				if err != nil {
					t.Fatalf("GetUserByUsername: %v", err)
				}
				if got.Username != "admin" {
					t.Fatalf("expected username 'admin', got %q", got.Username)
				}
				tx1.Rollback()
			},
		},
		{
			name: "update email and display_name",
			fn: func(t *testing.T) {
				tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				existing, err := tx1.GetUserByUsername(ctx, "admin")
				if err != nil {
					t.Fatalf("GetUserByUsername: %v", err)
				}
				tx1.Rollback()

				newEmail := "new@example.com"
				newDisplay := "Updated Admin"
				existing.Email = &newEmail
				existing.DisplayName = &newDisplay

				tx2, err := d.Begin(ctx, store.TxOptions{})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				updated, err := tx2.UpdateUser(ctx, existing)
				if err != nil {
					t.Fatalf("UpdateUser: %v", err)
				}
				if updated.Email == nil || *updated.Email != newEmail {
					t.Fatalf("expected email %q, got %v", newEmail, updated.Email)
				}
				if updated.DisplayName == nil || *updated.DisplayName != newDisplay {
					t.Fatalf("expected display_name %q, got %v", newDisplay, updated.DisplayName)
				}
				if err := tx2.Commit(); err != nil {
					t.Fatalf("Commit: %v", err)
				}
			},
		},
		{
			name: "list users",
			fn: func(t *testing.T) {
				// Create a second user.
				_ = createTestUser(t, d, "beta")

				tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				users, err := tx1.ListUsers(ctx)
				if err != nil {
					t.Fatalf("ListUsers: %v", err)
				}
				if len(users) != 2 {
					t.Fatalf("expected 2 users, got %d", len(users))
				}
				// Ordered by username: admin, beta.
				if users[0].Username != "admin" {
					t.Fatalf("expected first user 'admin', got %q", users[0].Username)
				}
				if users[1].Username != "beta" {
					t.Fatalf("expected second user 'beta', got %q", users[1].Username)
				}
				tx1.Rollback()
			},
		},
		{
			name: "delete user",
			fn: func(t *testing.T) {
				tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				existing, err := tx1.GetUserByUsername(ctx, "beta")
				if err != nil {
					t.Fatalf("GetUserByUsername: %v", err)
				}
				tx1.Rollback()

				tx2, err := d.Begin(ctx, store.TxOptions{})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				if err := tx2.DeleteUser(ctx, existing.ID); err != nil {
					t.Fatalf("DeleteUser: %v", err)
				}
				if err := tx2.Commit(); err != nil {
					t.Fatalf("Commit: %v", err)
				}

				// Verify deletion.
				tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				_, err = tx3.GetUser(ctx, existing.ID)
				if err == nil {
					t.Fatal("expected error after delete")
				}
				tx3.Rollback()
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, tc.fn)
	}
}

func TestSessionCRUD(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create a user first.
	user := createTestUser(t, d, "sessuser")

	now := time.Now().UTC().Truncate(time.Millisecond)
	ip := "192.168.1.1"
	ua := "TestAgent/1.0"

	tests := []struct {
		name string
		fn   func(t *testing.T)
	}{
		{
			name: "create and get session",
			fn: func(t *testing.T) {
				tx1, err := d.Begin(ctx, store.TxOptions{})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				sess, err := tx1.CreateSession(ctx, &store.Session{
					ID:          "sess-001",
					UserID:      user.ID,
					Fingerprint: "fp-abc",
					CreatedAt:   now,
					ExpiresAt:   now.Add(7 * 24 * time.Hour),
					LastActive:  now,
					IPAddress:   &ip,
					UserAgent:   &ua,
				})
				if err != nil {
					t.Fatalf("CreateSession: %v", err)
				}
				if sess.ID != "sess-001" {
					t.Fatalf("expected session ID 'sess-001', got %q", sess.ID)
				}
				if sess.Fingerprint != "fp-abc" {
					t.Fatalf("expected fingerprint 'fp-abc', got %q", sess.Fingerprint)
				}
				if sess.UserID != user.ID {
					t.Fatalf("expected user_id %q, got %q", user.ID, sess.UserID)
				}
				if sess.IPAddress == nil || *sess.IPAddress != ip {
					t.Fatalf("expected ip_address %q, got %v", ip, sess.IPAddress)
				}
				if sess.UserAgent == nil || *sess.UserAgent != ua {
					t.Fatalf("expected user_agent %q, got %v", ua, sess.UserAgent)
				}
				if err := tx1.Commit(); err != nil {
					t.Fatalf("Commit: %v", err)
				}

				// Get by ID.
				tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				got, err := tx2.GetSession(ctx, "sess-001")
				if err != nil {
					t.Fatalf("GetSession: %v", err)
				}
				if got.Fingerprint != "fp-abc" {
					t.Fatalf("expected fingerprint 'fp-abc', got %q", got.Fingerprint)
				}
				tx2.Rollback()
			},
		},
		{
			name: "update last active",
			fn: func(t *testing.T) {
				newActive := now.Add(2 * time.Hour)
				tx1, err := d.Begin(ctx, store.TxOptions{})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				if err := tx1.UpdateSessionLastActive(ctx, "sess-001", newActive); err != nil {
					t.Fatalf("UpdateSessionLastActive: %v", err)
				}
				if err := tx1.Commit(); err != nil {
					t.Fatalf("Commit: %v", err)
				}

				tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				got, err := tx2.GetSession(ctx, "sess-001")
				if err != nil {
					t.Fatalf("GetSession: %v", err)
				}
				// Compare truncated to milliseconds (our time format).
				if !got.LastActive.Equal(newActive.Truncate(time.Millisecond)) {
					t.Fatalf("expected last_active %v, got %v", newActive, got.LastActive)
				}
				tx2.Rollback()
			},
		},
		{
			name: "delete session",
			fn: func(t *testing.T) {
				tx1, err := d.Begin(ctx, store.TxOptions{})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				if err := tx1.DeleteSession(ctx, "sess-001"); err != nil {
					t.Fatalf("DeleteSession: %v", err)
				}
				if err := tx1.Commit(); err != nil {
					t.Fatalf("Commit: %v", err)
				}

				// Verify gone.
				tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				_, err = tx2.GetSession(ctx, "sess-001")
				if err == nil {
					t.Fatal("expected error after delete")
				}
				tx2.Rollback()
			},
		},
		{
			name: "delete sessions by user except",
			fn: func(t *testing.T) {
				// Create two sessions.
				tx1, err := d.Begin(ctx, store.TxOptions{})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				_, err = tx1.CreateSession(ctx, &store.Session{
					ID: "sess-keep", UserID: user.ID, Fingerprint: "fp-1",
					CreatedAt: now, ExpiresAt: now.Add(7 * 24 * time.Hour), LastActive: now,
				})
				if err != nil {
					t.Fatalf("CreateSession(keep): %v", err)
				}
				_, err = tx1.CreateSession(ctx, &store.Session{
					ID: "sess-delete", UserID: user.ID, Fingerprint: "fp-2",
					CreatedAt: now, ExpiresAt: now.Add(7 * 24 * time.Hour), LastActive: now,
				})
				if err != nil {
					t.Fatalf("CreateSession(delete): %v", err)
				}
				if err := tx1.Commit(); err != nil {
					t.Fatalf("Commit: %v", err)
				}

				// Delete all except sess-keep.
				tx2, err := d.Begin(ctx, store.TxOptions{})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				if err := tx2.DeleteSessionsByUserExcept(ctx, user.ID, "sess-keep"); err != nil {
					t.Fatalf("DeleteSessionsByUserExcept: %v", err)
				}
				if err := tx2.Commit(); err != nil {
					t.Fatalf("Commit: %v", err)
				}

				// Verify sess-keep remains, sess-delete is gone.
				tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
				if err != nil {
					t.Fatalf("Begin: %v", err)
				}
				sessions, err := tx3.ListSessionsByUser(ctx, user.ID)
				if err != nil {
					t.Fatalf("ListSessionsByUser: %v", err)
				}
				if len(sessions) != 1 {
					t.Fatalf("expected 1 session, got %d", len(sessions))
				}
				if sessions[0].ID != "sess-keep" {
					t.Fatalf("expected session 'sess-keep', got %q", sessions[0].ID)
				}
				tx3.Rollback()
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, tc.fn)
	}
}

func TestAccountLocking(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	user := createTestUser(t, d, "lockuser")

	// Increment 4 times without lock.
	for i := 0; i < 4; i++ {
		tx1, err := d.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("Begin: %v", err)
		}
		if err := tx1.IncrementFailedAttempts(ctx, user.ID, nil); err != nil {
			t.Fatalf("IncrementFailedAttempts[%d]: %v", i, err)
		}
		if err := tx1.Commit(); err != nil {
			t.Fatalf("Commit: %v", err)
		}
	}

	// Verify 4 failed attempts, status still active.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	u, err := tx2.GetUser(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if u.FailedAttempts != 4 {
		t.Fatalf("expected 4 failed_attempts, got %d", u.FailedAttempts)
	}
	if u.Status != "active" {
		t.Fatalf("expected status 'active', got %q", u.Status)
	}
	tx2.Rollback()

	// 5th attempt with lock.
	lockUntil := time.Now().UTC().Add(15 * time.Minute).Truncate(time.Millisecond)
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx3.IncrementFailedAttempts(ctx, user.ID, &lockUntil); err != nil {
		t.Fatalf("IncrementFailedAttempts(lock): %v", err)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify locked.
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	u, err = tx4.GetUser(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if u.Status != "locked" {
		t.Fatalf("expected status 'locked', got %q", u.Status)
	}
	if u.LockedUntil == nil {
		t.Fatal("expected non-nil locked_until")
	}
	if u.FailedAttempts != 5 {
		t.Fatalf("expected 5 failed_attempts, got %d", u.FailedAttempts)
	}
	tx4.Rollback()

	// Reset.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.ResetFailedAttempts(ctx, user.ID); err != nil {
		t.Fatalf("ResetFailedAttempts: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify reset.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	u, err = tx6.GetUser(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if u.FailedAttempts != 0 {
		t.Fatalf("expected 0 failed_attempts, got %d", u.FailedAttempts)
	}
	if u.LockedUntil != nil {
		t.Fatalf("expected nil locked_until, got %v", u.LockedUntil)
	}
	if u.Status != "active" {
		t.Fatalf("expected status 'active', got %q", u.Status)
	}
	tx6.Rollback()
}

func TestDeleteExpiredSessions(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	user := createTestUser(t, d, "expuser")

	now := time.Now().UTC().Truncate(time.Millisecond)

	// Create an expired session (expires_at in the past).
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx1.CreateSession(ctx, &store.Session{
		ID: "sess-expired", UserID: user.ID, Fingerprint: "fp-exp",
		CreatedAt: now.Add(-48 * time.Hour), ExpiresAt: now.Add(-1 * time.Hour),
		LastActive: now,
	})
	if err != nil {
		t.Fatalf("CreateSession(expired): %v", err)
	}

	// Create a valid session.
	_, err = tx1.CreateSession(ctx, &store.Session{
		ID: "sess-valid", UserID: user.ID, Fingerprint: "fp-valid",
		CreatedAt: now, ExpiresAt: now.Add(7 * 24 * time.Hour),
		LastActive: now,
	})
	if err != nil {
		t.Fatalf("CreateSession(valid): %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Delete expired.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	deleted, err := tx2.DeleteExpiredSessions(ctx)
	if err != nil {
		t.Fatalf("DeleteExpiredSessions: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("expected 1 deleted, got %d", deleted)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify valid session remains.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sessions, err := tx3.ListSessionsByUser(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListSessionsByUser: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session remaining, got %d", len(sessions))
	}
	if sessions[0].ID != "sess-valid" {
		t.Fatalf("expected session 'sess-valid', got %q", sessions[0].ID)
	}
	tx3.Rollback()
}
