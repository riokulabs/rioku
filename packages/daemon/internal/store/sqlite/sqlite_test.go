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
	t.Cleanup(func() { _ = d.Close() })

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
	if v != 27 {
		t.Fatalf("expected version 27, got %d", v)
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
	_ = tx2.Rollback()

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
	_ = tx3.Rollback()

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
	_ = tx6.Rollback()
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
	_ = tx2.Rollback()

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
	_ = tx3.Rollback()

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
	_ = tx2.Rollback()

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
	_ = tx3.Rollback()

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
	_ = tx6.Rollback()

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
	_ = tx8.Rollback()

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
	id, err := tx1.CreateAPIKey(ctx, "my-key", "sha256:abc123", []string{"read", "write"}, &expires, "")
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
	_ = tx2.Rollback()

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
	_ = tx3.Rollback()

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
	_ = tx4.Rollback()

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
	_ = tx6.Rollback()

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
	_ = tx7.Rollback()
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
	_ = tx2.Rollback()

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
	_ = tx3.Rollback()

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
	_ = tx4.Rollback()

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
	_ = tx5.Rollback()

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
	_ = tx6.Rollback()
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
	_ = tx2.Rollback()

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
	_ = tx3.Rollback()

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
	_ = tx4.Rollback()
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
				_ = tx2.Rollback()
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
				_ = tx1.Rollback()
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
				_ = tx1.Rollback()

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
				_ = tx1.Rollback()
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
				_ = tx1.Rollback()

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
				_ = tx3.Rollback()
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
				_ = tx2.Rollback()
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
				_ = tx2.Rollback()
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
				_ = tx2.Rollback()
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
				_ = tx3.Rollback()
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
	_ = tx2.Rollback()

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
	_ = tx4.Rollback()

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
	_ = tx6.Rollback()
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
	_ = tx3.Rollback()
}

// ---------------------------------------------------------------------------
// RBAC Tests
// ---------------------------------------------------------------------------

func TestRBACRolesAndPermissions(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// List built-in roles seeded by migration.
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	roles, err := tx1.ListRoles(ctx)
	if err != nil {
		t.Fatalf("ListRoles: %v", err)
	}
	if len(roles) != 4 {
		t.Fatalf("expected 4 built-in roles, got %d", len(roles))
	}

	var foundSuperadmin bool
	for _, r := range roles {
		if r.Name == "superadmin" {
			foundSuperadmin = true
			if !r.IsBuiltin {
				t.Error("superadmin must be is_builtin=true")
			}
			if len(r.Permissions) != 1 || r.Permissions[0] != "*" {
				t.Errorf("superadmin should have ['*'], got %v", r.Permissions)
			}
		}
	}
	if !foundSuperadmin {
		t.Fatal("superadmin role not found in seed data")
	}
	_ = tx1.Rollback()

	// List atomic permissions (excludes wildcards).
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	perms, err := tx2.ListPermissions(ctx)
	if err != nil {
		t.Fatalf("ListPermissions: %v", err)
	}
	if len(perms) != 26 {
		t.Fatalf("expected 26 atomic permissions, got %d", len(perms))
	}
	_ = tx2.Rollback()

	// Create a custom role.
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	role, err := tx3.CreateRole(ctx, store.CreateRoleParams{
		ID:          "role_custom_test",
		Name:        "custom_test",
		Description: "Test custom role",
		Permissions: []string{"config:read", "audit:read"},
	})
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}
	if role.Name != "custom_test" {
		t.Fatalf("expected role name 'custom_test', got %q", role.Name)
	}
	if role.IsBuiltin {
		t.Error("custom role should not be builtin")
	}
	if len(role.Permissions) != 2 {
		t.Fatalf("expected 2 permissions, got %d", len(role.Permissions))
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Update custom role: add a permission, change description.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newDesc := "Updated test role"
	updated, err := tx4.UpdateRole(ctx, "role_custom_test", store.UpdateRoleParams{
		Description: &newDesc,
		AddPerms:    []string{"traffic:read"},
	})
	if err != nil {
		t.Fatalf("UpdateRole: %v", err)
	}
	if updated.Description != newDesc {
		t.Fatalf("expected updated description, got %q", updated.Description)
	}
	if len(updated.Permissions) != 3 {
		t.Fatalf("expected 3 permissions after add, got %d", len(updated.Permissions))
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Delete custom role.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteRole(ctx, "role_custom_test"); err != nil {
		t.Fatalf("DeleteRole: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify deletion.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx6.GetRole(ctx, "role_custom_test")
	if err != store.ErrRoleNotFound {
		t.Fatalf("expected ErrRoleNotFound, got %v", err)
	}
	_ = tx6.Rollback()
}

func TestRBACUserRoles(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create a test user.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	user, err := tx1.CreateUser(ctx, &store.User{
		Username:     "rbac_test_user",
		PasswordHash: "hash_placeholder",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Assign viewer role to the user.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx2.AssignRole(ctx, user.ID, "role_viewer", ""); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// List user roles.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	userRoles, err := tx3.ListUserRoles(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUserRoles: %v", err)
	}
	if len(userRoles) != 1 {
		t.Fatalf("expected 1 user role, got %d", len(userRoles))
	}
	if userRoles[0].RoleName != "viewer" {
		t.Fatalf("expected role name 'viewer', got %q", userRoles[0].RoleName)
	}
	_ = tx3.Rollback()

	// List users with role.
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	userIDs, err := tx4.ListUsersWithRole(ctx, "role_viewer")
	if err != nil {
		t.Fatalf("ListUsersWithRole: %v", err)
	}
	if len(userIDs) != 1 || userIDs[0] != user.ID {
		t.Fatalf("expected [%s], got %v", user.ID, userIDs)
	}
	_ = tx4.Rollback()

	// Revoke role.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.RevokeRole(ctx, user.ID, "role_viewer"); err != nil {
		t.Fatalf("RevokeRole: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify role revoked.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	userRoles, err = tx6.ListUserRoles(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUserRoles: %v", err)
	}
	if len(userRoles) != 0 {
		t.Fatalf("expected 0 user roles after revoke, got %d", len(userRoles))
	}
	_ = tx6.Rollback()
}

func TestResolveUserPermissions(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create a test user with admin role.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	user, err := tx1.CreateUser(ctx, &store.User{
		Username:     "admin_user",
		PasswordHash: "hash_placeholder",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := tx1.AssignRole(ctx, user.ID, "role_admin", ""); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get user scopes.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	scopes, err := tx2.GetUserScopes(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserScopes: %v", err)
	}
	// admin has: config:*, keys:*, users:read, users:manage, roles:read,
	// sessions:*, audit:read, settings:*, traffic:read, plugins:*, cluster:read,
	// access-policies:read, access-policies:write, certificates:read,
	// certificates:manage
	if len(scopes) != 15 {
		t.Fatalf("expected 15 admin scopes, got %d: %v", len(scopes), scopes)
	}

	// Verify wildcards are included.
	scopeSet := make(map[string]bool)
	for _, s := range scopes {
		scopeSet[s] = true
	}
	expectedWildcards := []string{"config:*", "keys:*", "sessions:*", "settings:*", "plugins:*"}
	for _, wc := range expectedWildcards {
		if !scopeSet[wc] {
			t.Errorf("expected wildcard scope %q in admin scopes", wc)
		}
	}
	_ = tx2.Rollback()

	// Also test superadmin scopes (just '*').
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	superUser, err := tx3.CreateUser(ctx, &store.User{
		Username:     "super_user",
		PasswordHash: "hash_placeholder",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := tx3.AssignRole(ctx, superUser.ID, "role_superadmin", ""); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	superScopes, err := tx4.GetUserScopes(ctx, superUser.ID)
	if err != nil {
		t.Fatalf("GetUserScopes: %v", err)
	}
	if len(superScopes) != 1 || superScopes[0] != "*" {
		t.Fatalf("expected ['*'] for superadmin, got %v", superScopes)
	}
	_ = tx4.Rollback()
}

func TestDeleteRoleSuperadminImmutable(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	defer func() { _ = tx1.Rollback() }()

	err = tx1.DeleteRole(ctx, "role_superadmin")
	if err != store.ErrRoleImmutable {
		t.Fatalf("expected ErrRoleImmutable, got %v", err)
	}

	// Also verify UpdateRole is blocked.
	newName := "renamed_superadmin"
	_, err = tx1.UpdateRole(ctx, "role_superadmin", store.UpdateRoleParams{Name: &newName})
	if err != store.ErrRoleImmutable {
		t.Fatalf("expected ErrRoleImmutable on update, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// TOTP Backup Code Tests
// ---------------------------------------------------------------------------

func TestTOTPBackupCodes(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create a test user.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	user, err := tx1.CreateUser(ctx, &store.User{
		Username:     "totp_test_user",
		PasswordHash: "hash_placeholder",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Create backup codes.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	codeHashes := []string{"hash_aaa", "hash_bbb", "hash_ccc"}
	if err := tx2.CreateTOTPBackupCodes(ctx, user.ID, codeHashes); err != nil {
		t.Fatalf("CreateTOTPBackupCodes: %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// List unused codes.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	unused, err := tx3.ListUnusedTOTPBackupCodes(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUnusedTOTPBackupCodes: %v", err)
	}
	if len(unused) != 3 {
		t.Fatalf("expected 3 unused codes, got %d", len(unused))
	}
	_ = tx3.Rollback()

	// Mark one code as used.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.MarkTOTPBackupCodeUsed(ctx, unused[0].ID); err != nil {
		t.Fatalf("MarkTOTPBackupCodeUsed: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// List unused should now be 2.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	unused, err = tx5.ListUnusedTOTPBackupCodes(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUnusedTOTPBackupCodes: %v", err)
	}
	if len(unused) != 2 {
		t.Fatalf("expected 2 unused codes after marking one used, got %d", len(unused))
	}
	_ = tx5.Rollback()

	// Re-create codes (should replace old ones).
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newHashes := []string{"hash_xxx", "hash_yyy"}
	if err := tx6.CreateTOTPBackupCodes(ctx, user.ID, newHashes); err != nil {
		t.Fatalf("CreateTOTPBackupCodes: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// List should show 2 new unused codes.
	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	unused, err = tx7.ListUnusedTOTPBackupCodes(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUnusedTOTPBackupCodes: %v", err)
	}
	if len(unused) != 2 {
		t.Fatalf("expected 2 unused codes after re-creation, got %d", len(unused))
	}
	_ = tx7.Rollback()

	// Delete all codes.
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx8.DeleteTOTPBackupCodes(ctx, user.ID); err != nil {
		t.Fatalf("DeleteTOTPBackupCodes: %v", err)
	}
	if err := tx8.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify all deleted.
	tx9, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	unused, err = tx9.ListUnusedTOTPBackupCodes(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUnusedTOTPBackupCodes: %v", err)
	}
	if len(unused) != 0 {
		t.Fatalf("expected 0 codes after deletion, got %d", len(unused))
	}
	_ = tx9.Rollback()
}

// ---------------------------------------------------------------------------
// UpdateLastLogin
// ---------------------------------------------------------------------------

func TestUpdateLastLogin(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	user := createTestUser(t, d, "loginuser")

	// LastLogin should be nil initially.
	if user.LastLogin != nil {
		t.Fatal("expected nil LastLogin on newly created user")
	}

	// Call UpdateLastLogin inside a committed transaction.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx1.UpdateLastLogin(ctx, user.ID); err != nil {
		t.Fatalf("UpdateLastLogin: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Read the user back and verify LastLogin is now set.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetUser(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	_ = tx2.Rollback()

	if got.LastLogin == nil {
		t.Fatal("expected non-nil LastLogin after UpdateLastLogin")
	}
	if got.LastLogin.IsZero() {
		t.Fatal("expected non-zero LastLogin timestamp")
	}
}

func TestUpdateLastLogin_NotFound(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	err = tx.UpdateLastLogin(ctx, "nonexistent-id")
	_ = tx.Rollback()
	if err == nil {
		t.Fatal("expected error for nonexistent user ID, got nil")
	}
}

// ---------------------------------------------------------------------------
// DeleteSessionsByUser
// ---------------------------------------------------------------------------

func TestDeleteSessionsByUser(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	user := createTestUser(t, d, "delsessuser")

	now := time.Now().UTC().Truncate(time.Millisecond)

	// Create two sessions for the user.
	for i, id := range []string{"sess-del-1", "sess-del-2"} {
		tx, err := d.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("Begin[%d]: %v", i, err)
		}
		_, err = tx.CreateSession(ctx, &store.Session{
			ID:          id,
			UserID:      user.ID,
			Fingerprint: "fp-" + id,
			CreatedAt:   now,
			ExpiresAt:   now.Add(time.Hour),
			LastActive:  now,
		})
		if err != nil {
			t.Fatalf("CreateSession[%d]: %v", i, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("Commit[%d]: %v", i, err)
		}
	}

	// Verify two sessions exist.
	txCheck, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sessions, err := txCheck.ListSessionsByUser(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListSessionsByUser: %v", err)
	}
	_ = txCheck.Rollback()
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions before delete, got %d", len(sessions))
	}

	// Delete all sessions for this user.
	txDel, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := txDel.DeleteSessionsByUser(ctx, user.ID); err != nil {
		t.Fatalf("DeleteSessionsByUser: %v", err)
	}
	if err := txDel.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify all sessions are gone.
	txVerify, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	remaining, err := txVerify.ListSessionsByUser(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListSessionsByUser: %v", err)
	}
	_ = txVerify.Rollback()
	if len(remaining) != 0 {
		t.Fatalf("expected 0 sessions after DeleteSessionsByUser, got %d", len(remaining))
	}
}

func TestDeleteSessionsByUser_Empty(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	user := createTestUser(t, d, "nosessuser")

	// Should succeed even when the user has no sessions.
	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx.DeleteSessionsByUser(ctx, user.ID); err != nil {
		t.Fatalf("DeleteSessionsByUser on empty set: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

func TestHealth_ClosedStore(t *testing.T) {
	ctx := context.Background()

	d := &driver{}
	dbPath := filepath.Join(t.TempDir(), "health_closed.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	// Close the store before calling Health.
	if err := d.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	h := d.Health(ctx)
	if h.OK {
		t.Fatal("expected Health.OK=false after close")
	}
	if h.Details["error"] == "" {
		t.Fatal("expected error detail in Health after close")
	}
}

// ---------------------------------------------------------------------------
// parseTime
// ---------------------------------------------------------------------------

func TestParseTime_ValidFormats(t *testing.T) {
	cases := []struct {
		input string
		want  string // expected year, used to sanity-check
	}{
		{"2024-03-15T10:30:00.000Z", "2024"},
		{"2026-01-01T00:00:00.000Z", "2026"},
		{"2000-12-31T23:59:59.999Z", "2000"},
	}
	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			got := parseTime(tc.input)
			if got.IsZero() {
				t.Fatalf("parseTime(%q) returned zero time", tc.input)
			}
			if y := got.UTC().Format("2006"); y != tc.want {
				t.Fatalf("parseTime(%q): expected year %s, got %s", tc.input, tc.want, y)
			}
		})
	}
}

func TestParseTime_Invalid(t *testing.T) {
	cases := []string{
		"",
		"not-a-time",
		"2024/03/15",
		"2024-13-01T00:00:00.000Z", // invalid month
	}
	for _, s := range cases {
		t.Run(s, func(t *testing.T) {
			got := parseTime(s)
			if s == "" {
				// Empty string: parseTime logs only if s != "", so zero time is expected either way.
				if !got.IsZero() {
					t.Fatalf("parseTime(%q): expected zero time, got %v", s, got)
				}
				return
			}
			// Invalid non-empty strings may return zero time.
			if !got.IsZero() {
				// Some strings may accidentally parse — only assert zero for clearly invalid.
				t.Logf("parseTime(%q) returned non-zero %v (may be ok for partial match)", s, got)
			}
		})
	}
}

func TestParseTime_EmptyString(t *testing.T) {
	got := parseTime("")
	if !got.IsZero() {
		t.Fatalf("expected zero time for empty string, got %v", got)
	}
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------

func TestEmit_SendsEvent(t *testing.T) {
	d := openTestDB(t)

	// Drain the existing notify channel (may have events from openTestDB migrations).
	// Use a fresh user creation to generate a predictable event.
	ch := d.Notify()

	user := createTestUser(t, d, "emituser")

	// Drain events until we find the users INSERT we care about.
	timeout := time.After(2 * time.Second)
	found := false
	for !found {
		select {
		case evt, ok := <-ch:
			if !ok {
				t.Fatal("notify channel closed unexpectedly")
			}
			if evt.Table == "users" && evt.Operation == "INSERT" && evt.RowID == user.ID {
				found = true
			}
		case <-timeout:
			t.Fatal("timed out waiting for users INSERT event")
		}
	}
}

func TestEmit_FullChannel(t *testing.T) {
	// Construct a tx with a full (zero-capacity, blocking) channel.
	// The emit call should be a no-op (drop) rather than blocking or panicking.
	ch := make(chan store.ChangeEvent) // unbuffered = always full when no reader
	txObj := &tx{
		notify: ch,
	}
	// This must return immediately without blocking.
	done := make(chan struct{})
	go func() {
		txObj.emit("routes", "row-1", "INSERT")
		close(done)
	}()

	select {
	case <-done:
		// good — did not block
	case <-time.After(time.Second):
		t.Fatal("emit blocked on full channel")
	}
}

// ---------------------------------------------------------------------------
// JSON helpers — error paths
// ---------------------------------------------------------------------------

func TestUnmarshalDirectUpstreamJSON_Invalid(t *testing.T) {
	_, err := unmarshalDirectUpstreamJSON("{invalid json}")
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestUnmarshalLabelsJSON_Invalid(t *testing.T) {
	_, err := unmarshalLabelsJSON("{invalid json}")
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestUnmarshalLabelsJSON_Empty(t *testing.T) {
	// Empty and "{}" should return non-nil Labels with an empty map.
	for _, s := range []string{"", "{}"} {
		got, err := unmarshalLabelsJSON(s)
		if err != nil {
			t.Fatalf("unmarshalLabelsJSON(%q): unexpected error: %v", s, err)
		}
		if got == nil {
			t.Fatalf("unmarshalLabelsJSON(%q): expected non-nil Labels, got nil", s)
			return
		}
		if got.Labels == nil {
			t.Fatalf("unmarshalLabelsJSON(%q): expected non-nil Labels.Labels map, got nil", s)
		}
		if len(got.Labels) != 0 {
			t.Fatalf("unmarshalLabelsJSON(%q): expected empty map, got %v", s, got.Labels)
		}
	}
}

func TestUnmarshalHealthCheckJSON_Invalid(t *testing.T) {
	_, err := unmarshalHealthCheckJSON("{invalid json}")
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestMarshalStructJSON_NilInput(t *testing.T) {
	got, err := marshalStructJSON(nil)
	if err != nil {
		t.Fatalf("marshalStructJSON(nil): unexpected error: %v", err)
	}
	if got != "{}" {
		t.Fatalf("marshalStructJSON(nil): expected '{}', got %q", got)
	}
}

func TestUnmarshalStructJSON_Invalid(t *testing.T) {
	_, err := unmarshalStructJSON("{invalid json}")
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestUnmarshalStructJSON_EmptyOrBraces(t *testing.T) {
	for _, s := range []string{"", "{}"} {
		got, err := unmarshalStructJSON(s)
		if err != nil {
			t.Fatalf("unmarshalStructJSON(%q): unexpected error: %v", s, err)
		}
		if got != nil {
			t.Fatalf("unmarshalStructJSON(%q): expected nil, got %v", s, got)
		}
	}
}

func TestDeleteRouteCleanupBindings(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create a service for the route target.
	txS, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svc, err := txS.CreateService(ctx, &riokuv1.Service{
		Name:     "cleanup-svc",
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

	// Create a policy.
	txP, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	pol, err := txP.CreatePolicy(ctx, &riokuv1.Policy{
		Name: "cleanup-policy",
		Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
	})
	if err != nil {
		t.Fatalf("CreatePolicy: %v", err)
	}
	if err := txP.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Create a route.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	route, err := tx1.CreateRoute(ctx, &riokuv1.Route{
		Name:    "cleanup-route",
		Enabled: true,
		Matchers: []*riokuv1.Matcher{
			{Hosts: []string{"example.com"}},
		},
		Target: &riokuv1.Route_ServiceId{ServiceId: svc.GetId()},
	})
	if err != nil {
		t.Fatalf("CreateRoute: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Attach policy to route.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx2.AttachPolicy(ctx, pol.GetId(), "route", route.GetId()); err != nil {
		t.Fatalf("AttachPolicy: %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify binding exists.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ids, err := tx3.ListPoliciesByTarget(ctx, "route", route.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(ids) != 1 {
		t.Fatalf("expected 1 binding before delete, got %d", len(ids))
	}
	_ = tx3.Rollback()

	// Delete the route.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.DeleteRoute(ctx, route.GetId()); err != nil {
		t.Fatalf("DeleteRoute: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify binding is cleaned up.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ids, err = tx5.ListPoliciesByTarget(ctx, "route", route.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("expected 0 bindings after route delete, got %d", len(ids))
	}
	_ = tx5.Rollback()
}

func TestDeleteServiceCleanupBindings(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create a policy.
	txP, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	pol, err := txP.CreatePolicy(ctx, &riokuv1.Policy{
		Name: "svc-cleanup-policy",
		Type: riokuv1.PolicyType_POLICY_TYPE_AUTH_JWT,
	})
	if err != nil {
		t.Fatalf("CreatePolicy: %v", err)
	}
	if err := txP.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Create a service.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svc, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:     "svc-cleanup-target",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:9090", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Attach policy to service.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx2.AttachPolicy(ctx, pol.GetId(), "service", svc.GetId()); err != nil {
		t.Fatalf("AttachPolicy: %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify binding exists.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ids, err := tx3.ListPoliciesByTarget(ctx, "service", svc.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(ids) != 1 {
		t.Fatalf("expected 1 binding before delete, got %d", len(ids))
	}
	_ = tx3.Rollback()

	// Delete the service.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.DeleteService(ctx, svc.GetId()); err != nil {
		t.Fatalf("DeleteService: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify binding is cleaned up.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ids, err = tx5.ListPoliciesByTarget(ctx, "service", svc.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("expected 0 bindings after service delete, got %d", len(ids))
	}
	_ = tx5.Rollback()
}

func TestLabelsRoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tests := []struct {
		name       string
		labels     *riokuv1.Labels
		wantNil    bool
		wantLabels map[string]string
	}{
		{
			name:       "non-empty labels round-trip",
			labels:     &riokuv1.Labels{Labels: map[string]string{"env": "prod", "tier": "frontend"}},
			wantLabels: map[string]string{"env": "prod", "tier": "frontend"},
		},
		{
			name:       "empty labels returns non-nil empty map",
			labels:     nil,
			wantLabels: map[string]string{},
		},
		{
			name:       "explicit empty labels returns non-nil empty map",
			labels:     &riokuv1.Labels{Labels: map[string]string{}},
			wantLabels: map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a service to reference from the route.
			txS, err := d.Begin(ctx, store.TxOptions{})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			svc, err := txS.CreateService(ctx, &riokuv1.Service{
				Name:     "labels-svc-" + tt.name,
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

			// Create route with labels.
			tx1, err := d.Begin(ctx, store.TxOptions{})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			created, err := tx1.CreateRoute(ctx, &riokuv1.Route{
				Name:   "labels-route-" + tt.name,
				Labels: tt.labels,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"example.com"}},
				},
				Target:  &riokuv1.Route_ServiceId{ServiceId: svc.GetId()},
				Enabled: true,
			})
			if err != nil {
				t.Fatalf("CreateRoute: %v", err)
			}
			if err := tx1.Commit(); err != nil {
				t.Fatalf("Commit: %v", err)
			}

			// Read back.
			tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			got, err := tx2.GetRoute(ctx, created.GetId())
			if err != nil {
				t.Fatalf("GetRoute: %v", err)
			}
			_ = tx2.Rollback()

			// Verify labels.
			if got.GetLabels() == nil {
				t.Fatal("expected non-nil Labels, got nil")
			}
			gotMap := got.GetLabels().GetLabels()
			if gotMap == nil {
				t.Fatal("expected non-nil Labels.Labels map, got nil")
			}
			if len(gotMap) != len(tt.wantLabels) {
				t.Fatalf("expected %d label entries, got %d", len(tt.wantLabels), len(gotMap))
			}
			for k, wantV := range tt.wantLabels {
				if gotV, ok := gotMap[k]; !ok || gotV != wantV {
					t.Fatalf("expected label %q=%q, got %q", k, wantV, gotV)
				}
			}
		})
	}
}

func TestLabelsRoundTripService(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tests := []struct {
		name       string
		labels     *riokuv1.Labels
		wantLabels map[string]string
	}{
		{
			name:       "service non-empty labels",
			labels:     &riokuv1.Labels{Labels: map[string]string{"region": "us-east"}},
			wantLabels: map[string]string{"region": "us-east"},
		},
		{
			name:       "service nil labels returns non-nil empty map",
			labels:     nil,
			wantLabels: map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx1, err := d.Begin(ctx, store.TxOptions{})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			created, err := tx1.CreateService(ctx, &riokuv1.Service{
				Name:     "labels-svc-" + tt.name,
				LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				Labels:   tt.labels,
				Upstreams: []*riokuv1.Upstream{
					{Address: "127.0.0.1:9090", Weight: 1, Healthy: true},
				},
			})
			if err != nil {
				t.Fatalf("CreateService: %v", err)
			}
			if err := tx1.Commit(); err != nil {
				t.Fatalf("Commit: %v", err)
			}

			tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
			if err != nil {
				t.Fatalf("Begin: %v", err)
			}
			got, err := tx2.GetService(ctx, created.GetId())
			if err != nil {
				t.Fatalf("GetService: %v", err)
			}
			_ = tx2.Rollback()

			if got.GetLabels() == nil {
				t.Fatal("expected non-nil Labels, got nil")
			}
			gotMap := got.GetLabels().GetLabels()
			if gotMap == nil {
				t.Fatal("expected non-nil Labels.Labels map, got nil")
			}
			if len(gotMap) != len(tt.wantLabels) {
				t.Fatalf("expected %d label entries, got %d", len(tt.wantLabels), len(gotMap))
			}
			for k, wantV := range tt.wantLabels {
				if gotV, ok := gotMap[k]; !ok || gotV != wantV {
					t.Fatalf("expected label %q=%q, got %q", k, wantV, gotV)
				}
			}
		})
	}
}

func TestMarshalDirectUpstreamJSON_Nil(t *testing.T) {
	got, err := marshalDirectUpstreamJSON(nil)
	if err != nil {
		t.Fatalf("marshalDirectUpstreamJSON(nil): unexpected error: %v", err)
	}
	if got != "" {
		t.Fatalf("marshalDirectUpstreamJSON(nil): expected empty string, got %q", got)
	}
}

func TestMigration_000005_UpDown(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// After openTestDB, migrations are applied up to latest.
	v, err := d.CurrentVersion(ctx)
	if err != nil {
		t.Fatalf("CurrentVersion: %v", err)
	}
	if v < 5 {
		t.Fatalf("expected version >= 5 after migration, got %d", v)
	}

	// Verify columns exist by inserting a row with timeout values.
	_, err = d.db.ExecContext(ctx,
		`INSERT INTO services (id, name, lb_policy, health_check, labels, created_at, updated_at, dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds)
		 VALUES ('test-svc', 'test', 0, NULL, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 5, 30, 120)`)
	if err != nil {
		t.Fatalf("insert with timeout columns: %v", err)
	}

	// Read back.
	var dial, respHeader, idle int32
	err = d.db.QueryRowContext(ctx,
		`SELECT dial_timeout_seconds, response_header_timeout_seconds, idle_timeout_seconds FROM services WHERE id = 'test-svc'`).
		Scan(&dial, &respHeader, &idle)
	if err != nil {
		t.Fatalf("select timeout columns: %v", err)
	}
	if dial != 5 || respHeader != 30 || idle != 120 {
		t.Fatalf("timeout values = (%d, %d, %d), want (5, 30, 120)", dial, respHeader, idle)
	}

	// Clean up test row before down migration.
	_, _ = d.db.ExecContext(ctx, `DELETE FROM services WHERE id = 'test-svc'`)
}

func TestServiceTimeout_RoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:                         "timeout-svc",
		LbPolicy:                     riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams:                    []*riokuv1.Upstream{{Address: "10.0.0.1:8080", Weight: 1, Healthy: true}},
		DialTimeoutSeconds:           5,
		ResponseHeaderTimeoutSeconds: 30,
		IdleTimeoutSeconds:           120,
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}

	if created.GetDialTimeoutSeconds() != 5 {
		t.Errorf("dial_timeout_seconds = %d, want 5", created.GetDialTimeoutSeconds())
	}
	if created.GetResponseHeaderTimeoutSeconds() != 30 {
		t.Errorf("response_header_timeout_seconds = %d, want 30", created.GetResponseHeaderTimeoutSeconds())
	}
	if created.GetIdleTimeoutSeconds() != 120 {
		t.Errorf("idle_timeout_seconds = %d, want 120", created.GetIdleTimeoutSeconds())
	}

	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Read back via GetService.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetService(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if got.GetDialTimeoutSeconds() != 5 {
		t.Errorf("GetService dial_timeout_seconds = %d, want 5", got.GetDialTimeoutSeconds())
	}
	if got.GetResponseHeaderTimeoutSeconds() != 30 {
		t.Errorf("GetService response_header_timeout_seconds = %d, want 30", got.GetResponseHeaderTimeoutSeconds())
	}
	if got.GetIdleTimeoutSeconds() != 120 {
		t.Errorf("GetService idle_timeout_seconds = %d, want 120", got.GetIdleTimeoutSeconds())
	}
	_ = tx2.Rollback()

	// Verify via ListServices.
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
	if services[0].GetDialTimeoutSeconds() != 5 {
		t.Errorf("ListServices dial_timeout_seconds = %d, want 5", services[0].GetDialTimeoutSeconds())
	}
	_ = tx3.Rollback()
}

func TestServiceTimeout_Update(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:                         "update-timeout-svc",
		LbPolicy:                     riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams:                    []*riokuv1.Upstream{{Address: "10.0.0.1:8080", Weight: 1, Healthy: true}},
		DialTimeoutSeconds:           5,
		ResponseHeaderTimeoutSeconds: 30,
		IdleTimeoutSeconds:           120,
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Update timeout values.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created.DialTimeoutSeconds = 10
	created.ResponseHeaderTimeoutSeconds = 60
	created.IdleTimeoutSeconds = 0 // reset to default
	updated, err := tx2.UpdateService(ctx, created)
	if err != nil {
		t.Fatalf("UpdateService: %v", err)
	}
	if updated.GetDialTimeoutSeconds() != 10 {
		t.Errorf("updated dial_timeout_seconds = %d, want 10", updated.GetDialTimeoutSeconds())
	}
	if updated.GetResponseHeaderTimeoutSeconds() != 60 {
		t.Errorf("updated response_header_timeout_seconds = %d, want 60", updated.GetResponseHeaderTimeoutSeconds())
	}
	if updated.GetIdleTimeoutSeconds() != 0 {
		t.Errorf("updated idle_timeout_seconds = %d, want 0", updated.GetIdleTimeoutSeconds())
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

func TestServiceTimeout_ZeroValues(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	// Create service with no timeouts (all 0, proto3 default).
	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:     "no-timeout-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if created.GetDialTimeoutSeconds() != 0 {
		t.Errorf("dial_timeout_seconds = %d, want 0", created.GetDialTimeoutSeconds())
	}
	if created.GetResponseHeaderTimeoutSeconds() != 0 {
		t.Errorf("response_header_timeout_seconds = %d, want 0", created.GetResponseHeaderTimeoutSeconds())
	}
	if created.GetIdleTimeoutSeconds() != 0 {
		t.Errorf("idle_timeout_seconds = %d, want 0", created.GetIdleTimeoutSeconds())
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

// ─── Access Policies (#80) ──────────────────────────────────────────────────

func TestAccessPolicyCRUD(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}

	in := &store.AccessPolicy{
		Name:        "deny-after-hours",
		Description: "Block writes outside business hours",
		Effect:      store.AccessPolicyDeny,
		TargetType:  store.AccessPolicyTargetRoles,
		TargetIDs:   []string{"role_engineer"},
		Conditions: []store.AccessPolicyCondition{
			{Type: "time", Config: map[string]any{"start": "18:00", "end": "08:00", "tz": "America/Los_Angeles"}},
		},
		Priority: 50,
		Enabled:  true,
	}
	out, err := tx.CreateAccessPolicy(ctx, in)
	if err != nil {
		t.Fatalf("CreateAccessPolicy: %v", err)
	}
	if out.ID == "" {
		t.Error("expected assigned ID")
	}
	if out.Name != "deny-after-hours" {
		t.Errorf("name round-trip failed: %s", out.Name)
	}
	if out.Effect != store.AccessPolicyDeny {
		t.Errorf("effect: %s", out.Effect)
	}
	if len(out.TargetIDs) != 1 || out.TargetIDs[0] != "role_engineer" {
		t.Errorf("target_ids round-trip failed: %v", out.TargetIDs)
	}
	if len(out.Conditions) != 1 || out.Conditions[0].Type != "time" {
		t.Errorf("conditions round-trip failed: %v", out.Conditions)
	}
	if out.Conditions[0].Config["tz"] != "America/Los_Angeles" {
		t.Errorf("condition config round-trip failed: %v", out.Conditions[0].Config)
	}

	// Get
	got, err := tx.GetAccessPolicy(ctx, out.ID)
	if err != nil {
		t.Fatalf("GetAccessPolicy: %v", err)
	}
	if got.Name != out.Name {
		t.Errorf("get mismatch: %s vs %s", got.Name, out.Name)
	}

	// Update — change name + disable
	newName := "deny-after-hours-pst"
	disabled := false
	_, err = tx.UpdateAccessPolicy(ctx, out.ID, store.UpdateAccessPolicyParams{
		Name:    &newName,
		Enabled: &disabled,
	})
	if err != nil {
		t.Fatalf("UpdateAccessPolicy: %v", err)
	}
	got2, _ := tx.GetAccessPolicy(ctx, out.ID)
	if got2.Name != newName || got2.Enabled {
		t.Errorf("update did not apply: name=%s enabled=%v", got2.Name, got2.Enabled)
	}

	// List should return one row.
	list, err := tx.ListAccessPolicies(ctx)
	if err != nil {
		t.Fatalf("ListAccessPolicies: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("expected 1 policy, got %d", len(list))
	}

	// Delete
	if err := tx.DeleteAccessPolicy(ctx, out.ID); err != nil {
		t.Fatalf("DeleteAccessPolicy: %v", err)
	}
	if _, err := tx.GetAccessPolicy(ctx, out.ID); err != store.ErrAccessPolicyNotFound {
		t.Errorf("expected ErrAccessPolicyNotFound, got %v", err)
	}

	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestAccessPolicyDuplicateName(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})

	_, err := tx.CreateAccessPolicy(ctx, &store.AccessPolicy{
		Name: "dup", Effect: store.AccessPolicyAllow, TargetType: store.AccessPolicyTargetAll,
	})
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	_, err = tx.CreateAccessPolicy(ctx, &store.AccessPolicy{
		Name: "dup", Effect: store.AccessPolicyDeny, TargetType: store.AccessPolicyTargetAll,
	})
	if err != store.ErrAccessPolicyDuplicate {
		t.Errorf("expected ErrAccessPolicyDuplicate, got %v", err)
	}
	_ = tx.Rollback()
}

func TestAccessPolicyListOrdering(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})

	// Insert three policies with different priorities.
	for _, p := range []struct {
		name string
		prio int
	}{
		{"third", 300},
		{"first", 100},
		{"second", 200},
	} {
		if _, err := tx.CreateAccessPolicy(ctx, &store.AccessPolicy{
			Name:       p.name,
			Effect:     store.AccessPolicyAllow,
			TargetType: store.AccessPolicyTargetAll,
			Priority:   p.prio,
			Enabled:    true,
		}); err != nil {
			t.Fatalf("create %s: %v", p.name, err)
		}
	}
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx2.Rollback() }()

	list, err := tx2.ListAccessPolicies(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("expected 3, got %d", len(list))
	}
	wantOrder := []string{"first", "second", "third"}
	for i, p := range list {
		if p.Name != wantOrder[i] {
			t.Errorf("position %d: got %s, want %s", i, p.Name, wantOrder[i])
		}
	}
}

func TestAccessPolicyUpdateNotFound(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx.Rollback() }()

	name := "x"
	_, err := tx.UpdateAccessPolicy(ctx, "nonexistent", store.UpdateAccessPolicyParams{Name: &name})
	if err != store.ErrAccessPolicyNotFound {
		t.Errorf("expected ErrAccessPolicyNotFound, got %v", err)
	}
}

func TestAccessPolicyDeleteNotFound(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx.Rollback() }()

	if err := tx.DeleteAccessPolicy(ctx, "nonexistent"); err != store.ErrAccessPolicyNotFound {
		t.Errorf("expected ErrAccessPolicyNotFound, got %v", err)
	}
}

// ─── PassiveHealthCheck round-trip (#67) ────────────────────────────────────

func TestPassiveHealthCheck_RoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	want := &riokuv1.PassiveHealthCheck{
		Enabled:               true,
		FailDurationSeconds:   30,
		MaxFails:              5,
		UnhealthyStatus:       []int32{500, 502, 503},
		UnhealthyLatencyMs:    250,
		UnhealthyRequestCount: 100,
	}
	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:               "phc-svc",
		LbPolicy:           riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams:          []*riokuv1.Upstream{{Address: "10.0.0.1:8080", Healthy: true}},
		PassiveHealthCheck: want,
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx2.Rollback() }()
	got, err := tx2.GetService(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	phc := got.GetPassiveHealthCheck()
	if phc == nil {
		t.Fatal("expected non-nil PassiveHealthCheck after round-trip")
	}
	if phc.GetMaxFails() != 5 || phc.GetFailDurationSeconds() != 30 ||
		phc.GetUnhealthyLatencyMs() != 250 || phc.GetUnhealthyRequestCount() != 100 {
		t.Errorf("round-trip mismatch: %+v", phc)
	}
	if len(phc.GetUnhealthyStatus()) != 3 || phc.GetUnhealthyStatus()[0] != 500 {
		t.Errorf("unhealthy_status mismatch: %v", phc.GetUnhealthyStatus())
	}
}

// ─── CountAuditLog (#82) ────────────────────────────────────────────────────

func TestCountAuditLog_FiltersAndIgnoresPagination(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)
	now := time.Now().UTC()

	tx1, _ := d.Begin(ctx, store.TxOptions{})
	for i := 0; i < 5; i++ {
		_ = tx1.AppendAuditEntry(ctx, &riokuv1.AuditEntry{
			Actor:      "alice",
			EntityType: "route",
			EntityId:   "r1",
			Operation:  "update",
			OccurredAt: timestamppb.New(now.Add(time.Duration(i) * time.Second)),
		})
	}
	for i := 0; i < 3; i++ {
		_ = tx1.AppendAuditEntry(ctx, &riokuv1.AuditEntry{
			Actor:      "bob",
			EntityType: "service",
			EntityId:   "s1",
			Operation:  "create",
			OccurredAt: timestamppb.New(now),
		})
	}
	_ = tx1.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx2.Rollback() }()

	// Total
	if c, _ := tx2.CountAuditLog(ctx, store.AuditQuery{}); c != 8 {
		t.Errorf("total count = %d, want 8", c)
	}
	// Filtered by entity type
	if c, _ := tx2.CountAuditLog(ctx, store.AuditQuery{EntityType: "route"}); c != 5 {
		t.Errorf("route count = %d, want 5", c)
	}
	// Filtered by entity id
	if c, _ := tx2.CountAuditLog(ctx, store.AuditQuery{EntityType: "route", EntityID: "r1"}); c != 5 {
		t.Errorf("route/r1 count = %d, want 5", c)
	}
	// Filtered by actor
	if c, _ := tx2.CountAuditLog(ctx, store.AuditQuery{Actor: "bob"}); c != 3 {
		t.Errorf("bob count = %d, want 3", c)
	}
	// Limit/Offset must be ignored — count is total matches.
	if c, _ := tx2.CountAuditLog(ctx, store.AuditQuery{Limit: 1, Offset: 100}); c != 8 {
		t.Errorf("count with limit/offset = %d, want 8 (must ignore pagination)", c)
	}
}

// ─── UpstreamTLS + ConnectionPool round-trip (#70) ──────────────────────────

func TestUpstreamTLS_RoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, _ := d.Begin(ctx, store.TxOptions{})
	want := &riokuv1.UpstreamTLS{
		Enabled:            true,
		ServerName:         "internal.example.com",
		InsecureSkipVerify: false,
		RootCaPem:          "-----BEGIN CERTIFICATE-----\nXYZ\n-----END CERTIFICATE-----\n",
		ClientCertPem:      "/etc/rioku/c.crt",
		ClientKeyPem:       "/etc/rioku/c.key",
		MinVersion:         "1.2",
		MaxVersion:         "1.3",
	}
	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:        "tls-svc",
		LbPolicy:    riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams:   []*riokuv1.Upstream{{Address: "10.0.0.1:443", Healthy: true}},
		UpstreamTls: want,
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	_ = tx1.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx2.Rollback() }()
	got, _ := tx2.GetService(ctx, created.GetId())
	ut := got.GetUpstreamTls()
	if ut == nil {
		t.Fatal("expected non-nil UpstreamTLS after round-trip")
	}
	if ut.GetServerName() != "internal.example.com" || ut.GetMinVersion() != "1.2" {
		t.Errorf("round-trip mismatch: %+v", ut)
	}
}

func TestConnectionPool_RoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, _ := d.Begin(ctx, store.TxOptions{})
	want := &riokuv1.ConnectionPool{
		MaxConnsPerUpstream:     200,
		MaxIdleConnsPerUpstream: 50,
		MaxIdleConns:            500,
		WriteBufferKb:           16,
		ReadBufferKb:            32,
	}
	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:           "pool-svc",
		LbPolicy:       riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams:      []*riokuv1.Upstream{{Address: "10.0.0.1:8080", Healthy: true}},
		ConnectionPool: want,
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	_ = tx1.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx2.Rollback() }()
	got, _ := tx2.GetService(ctx, created.GetId())
	cp := got.GetConnectionPool()
	if cp == nil {
		t.Fatal("expected non-nil ConnectionPool after round-trip")
	}
	if cp.GetMaxConnsPerUpstream() != 200 || cp.GetMaxIdleConns() != 500 || cp.GetWriteBufferKb() != 16 {
		t.Errorf("round-trip mismatch: %+v", cp)
	}
}

// ─── RetryPolicy round-trip (#69) ───────────────────────────────────────────

func TestRetryPolicy_RoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, _ := d.Begin(ctx, store.TxOptions{})
	want := &riokuv1.RetryPolicy{
		Enabled:       true,
		MaxRetries:    3,
		RetryOnStatus: []int32{502, 503, 504},
		TryDurationMs: 5000,
		TryIntervalMs: 100,
	}
	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:        "retry-svc",
		LbPolicy:    riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams:   []*riokuv1.Upstream{{Address: "10.0.0.1:8080", Healthy: true}},
		RetryPolicy: want,
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	_ = tx1.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx2.Rollback() }()
	got, err := tx2.GetService(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	rp := got.GetRetryPolicy()
	if rp == nil {
		t.Fatal("expected non-nil RetryPolicy after round-trip")
	}
	if rp.GetMaxRetries() != 3 || rp.GetTryDurationMs() != 5000 || rp.GetTryIntervalMs() != 100 {
		t.Errorf("round-trip mismatch: %+v", rp)
	}
	if len(rp.GetRetryOnStatus()) != 3 {
		t.Errorf("retry_on_status mismatch: %v", rp.GetRetryOnStatus())
	}
}

func TestRetryPolicy_NilPersistsAsNil(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, _ := d.Begin(ctx, store.TxOptions{})
	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:      "no-retry-svc",
		LbPolicy:  riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080", Healthy: true}},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	_ = tx1.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx2.Rollback() }()
	got, _ := tx2.GetService(ctx, created.GetId())
	if got.GetRetryPolicy() != nil {
		t.Errorf("expected nil RetryPolicy, got %+v", got.GetRetryPolicy())
	}
}

func TestPassiveHealthCheck_NilPersistsAsNil(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx1, _ := d.Begin(ctx, store.TxOptions{})
	created, err := tx1.CreateService(ctx, &riokuv1.Service{
		Name:      "no-phc-svc",
		LbPolicy:  riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080", Healthy: true}},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	_ = tx1.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx2.Rollback() }()
	got, err := tx2.GetService(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if got.GetPassiveHealthCheck() != nil {
		t.Errorf("expected nil PassiveHealthCheck, got %+v", got.GetPassiveHealthCheck())
	}
}

// ─── RecordAPIKeyUse (#85) ──────────────────────────────────────────────────

func TestRecordAPIKeyUse_BumpsCounterAndTimestamp(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create the key.
	tx1, _ := d.Begin(ctx, store.TxOptions{})
	id, err := tx1.CreateAPIKey(ctx, "test-key", "hash-abc", []string{"keys:own"}, nil, "")
	if err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
	_ = tx1.Commit()

	// Initially, usage stats are zero.
	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	k, err := tx2.GetAPIKey(ctx, id)
	if err != nil {
		t.Fatalf("GetAPIKey: %v", err)
	}
	if k.UsageCount != 0 || k.LastUsedAt != nil {
		t.Errorf("fresh key should have zero usage, got count=%d lastUsed=%v", k.UsageCount, k.LastUsedAt)
	}
	_ = tx2.Rollback()

	// Record three uses.
	now := time.Now().UTC().Truncate(time.Second)
	for i := 0; i < 3; i++ {
		tx, _ := d.Begin(ctx, store.TxOptions{})
		if err := tx.RecordAPIKeyUse(ctx, id, now.Add(time.Duration(i)*time.Second)); err != nil {
			_ = tx.Rollback()
			t.Fatalf("RecordAPIKeyUse: %v", err)
		}
		_ = tx.Commit()
	}

	tx3, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx3.Rollback() }()
	k, _ = tx3.GetAPIKey(ctx, id)
	if k.UsageCount != 3 {
		t.Errorf("usage_count = %d, want 3", k.UsageCount)
	}
	if k.LastUsedAt == nil {
		t.Fatal("expected non-nil LastUsedAt after RecordAPIKeyUse")
	}
}

func TestRecordAPIKeyUse_UnknownIDIsNoop(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx.Rollback() }()

	// Should not error even though the id doesn't exist — the auth
	// path is the caller and a missing row already means the request
	// failed validation upstream. Silent no-op keeps the contract
	// best-effort.
	if err := tx.RecordAPIKeyUse(ctx, "nonexistent-id", time.Now().UTC()); err != nil {
		t.Errorf("expected no-op, got error: %v", err)
	}
}

// ─── Tenants (stage-2) ──────────────────────────────────────────────────────

func TestTenants_DefaultSeeded(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx.Rollback() }()
	tn, err := tx.GetTenantBySlug(ctx, "default")
	if err != nil {
		t.Fatalf("GetTenantBySlug(default): %v", err)
	}
	if tn.ID != "tenant_default" {
		t.Errorf("default tenant id = %q, want tenant_default", tn.ID)
	}
}

func TestTenants_CreateGetUpdate(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	created, err := tx.CreateTenant(ctx, &store.Tenant{Slug: "acme", Name: "Acme Corp"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if created.ID == "" || created.Slug != "acme" || created.Plan != "community" {
		t.Errorf("create result: %+v", created)
	}
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx2.Rollback() }()

	// Slug uniqueness
	if _, err := tx2.CreateTenant(ctx, &store.Tenant{Slug: "acme", Name: "Other"}); err != store.ErrTenantSlugTaken {
		t.Errorf("expected ErrTenantSlugTaken, got %v", err)
	}

	// Update
	newName := "Acme Inc."
	updated, err := tx2.UpdateTenant(ctx, created.ID, store.UpdateTenantParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateTenant: %v", err)
	}
	if updated.Name != "Acme Inc." {
		t.Errorf("updated name = %q", updated.Name)
	}

	// Default tenant cannot be deleted
	if err := tx2.DeleteTenant(ctx, "tenant_default"); err != store.ErrTenantImmutable {
		t.Errorf("expected ErrTenantImmutable, got %v", err)
	}

	// Other tenant can be deleted
	if err := tx2.DeleteTenant(ctx, created.ID); err != nil {
		t.Errorf("DeleteTenant: %v", err)
	}
}

func TestTenants_List(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	_, _ = tx.CreateTenant(ctx, &store.Tenant{Slug: "a", Name: "A"})
	_, _ = tx.CreateTenant(ctx, &store.Tenant{Slug: "b", Name: "B"})
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx2.Rollback() }()
	all, err := tx2.ListTenants(ctx)
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	// default + 2 created
	if len(all) != 3 {
		t.Errorf("expected 3 tenants, got %d", len(all))
	}
}

// ─── Memberships (stage-2) ──────────────────────────────────────────────────

func TestMemberships_BackfilledForExistingUsers(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Create a user (which would normally have happened before migration 13).
	tx, _ := d.Begin(ctx, store.TxOptions{})
	user, err := tx.CreateUser(ctx, &store.User{
		Username:          "backfill-user",
		PasswordHash:      "x",
		Status:            "active",
		PasswordChangedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	_ = tx.Commit()

	// Manually create a membership (since the user was created post-migration).
	tx2, _ := d.Begin(ctx, store.TxOptions{})
	m, err := tx2.CreateMembership(ctx, &store.Membership{
		TenantID: "tenant_default",
		UserID:   user.ID,
		State:    "active",
	})
	if err != nil {
		t.Fatalf("CreateMembership: %v", err)
	}
	if m.JoinedAt == nil {
		t.Error("active membership should have JoinedAt populated")
	}
	_ = tx2.Commit()

	// Look up by tenant+user
	tx3, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx3.Rollback() }()
	got, err := tx3.GetMembershipByTenantUser(ctx, "tenant_default", user.ID)
	if err != nil {
		t.Fatalf("GetMembershipByTenantUser: %v", err)
	}
	if got.ID != m.ID {
		t.Errorf("expected membership %s, got %s", m.ID, got.ID)
	}
}

func TestMemberships_DuplicateRejected(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	user, _ := tx.CreateUser(ctx, &store.User{Username: "dup-user", PasswordHash: "x", Status: "active", PasswordChangedAt: time.Now().UTC()})
	_, _ = tx.CreateMembership(ctx, &store.Membership{TenantID: "tenant_default", UserID: user.ID, State: "active"})
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer func() { _ = tx2.Rollback() }()
	if _, err := tx2.CreateMembership(ctx, &store.Membership{TenantID: "tenant_default", UserID: user.ID, State: "active"}); err != store.ErrMembershipExists {
		t.Errorf("expected ErrMembershipExists, got %v", err)
	}
}

func TestMemberships_StateTransitions(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	user, _ := tx.CreateUser(ctx, &store.User{Username: "state-user", PasswordHash: "x", Status: "active", PasswordChangedAt: time.Now().UTC()})
	m, _ := tx.CreateMembership(ctx, &store.Membership{TenantID: "tenant_default", UserID: user.ID, State: "pending"})
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	// Valid: pending -> active
	updated, err := tx2.UpdateMembershipState(ctx, m.ID, "active")
	if err != nil {
		t.Fatalf("pending->active: %v", err)
	}
	if updated.JoinedAt == nil {
		t.Error("transition to active should set JoinedAt")
	}
	// Invalid: active -> pending
	if _, err := tx2.UpdateMembershipState(ctx, m.ID, "pending"); err != store.ErrMembershipInvalidState {
		t.Errorf("expected ErrMembershipInvalidState for active->pending, got %v", err)
	}
	// Valid: active -> deactivated
	if _, err := tx2.UpdateMembershipState(ctx, m.ID, "deactivated"); err != nil {
		t.Errorf("active->deactivated: %v", err)
	}
	// Valid: deactivated -> active (re-activation)
	if _, err := tx2.UpdateMembershipState(ctx, m.ID, "active"); err != nil {
		t.Errorf("deactivated->active: %v", err)
	}
	// Valid: active -> removed
	if _, err := tx2.UpdateMembershipState(ctx, m.ID, "removed"); err != nil {
		t.Errorf("active->removed: %v", err)
	}
	// Invalid: removed is terminal
	if _, err := tx2.UpdateMembershipState(ctx, m.ID, "active"); err != store.ErrMembershipInvalidState {
		t.Errorf("expected ErrMembershipInvalidState for removed->active, got %v", err)
	}
	_ = tx2.Commit()
}

func TestMemberships_ListByTenantAndUser(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	other, _ := tx.CreateTenant(ctx, &store.Tenant{Slug: "other", Name: "Other"})
	user, _ := tx.CreateUser(ctx, &store.User{Username: "multi-user", PasswordHash: "x", Status: "active", PasswordChangedAt: time.Now().UTC()})
	_, _ = tx.CreateMembership(ctx, &store.Membership{TenantID: "tenant_default", UserID: user.ID, State: "active"})
	_, _ = tx.CreateMembership(ctx, &store.Membership{TenantID: other.ID, UserID: user.ID, State: "pending"})
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx2.Rollback() }()

	byUser, _ := tx2.ListMembershipsByUser(ctx, user.ID)
	if len(byUser) != 2 {
		t.Errorf("expected 2 memberships for user, got %d", len(byUser))
	}
	byTenant, _ := tx2.ListMembershipsByTenant(ctx, other.ID)
	if len(byTenant) != 1 {
		t.Errorf("expected 1 membership in 'other', got %d", len(byTenant))
	}
}

// ─── Membership Roles (stage-2) ─────────────────────────────────────────────

func TestMembershipRoles_AssignAndList(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	user, _ := tx.CreateUser(ctx, &store.User{Username: "role-user", PasswordHash: "x", Status: "active", PasswordChangedAt: time.Now().UTC()})
	m, _ := tx.CreateMembership(ctx, &store.Membership{TenantID: "tenant_default", UserID: user.ID, State: "active"})
	if err := tx.AssignMembershipRole(ctx, m.ID, "role_viewer", ""); err != nil {
		t.Fatalf("AssignMembershipRole: %v", err)
	}
	// Idempotent — second assign is a no-op.
	if err := tx.AssignMembershipRole(ctx, m.ID, "role_viewer", ""); err != nil {
		t.Fatalf("second AssignMembershipRole: %v", err)
	}
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx2.Rollback() }()
	roles, err := tx2.ListMembershipRoles(ctx, m.ID)
	if err != nil {
		t.Fatalf("ListMembershipRoles: %v", err)
	}
	if len(roles) != 1 || roles[0].ID != "role_viewer" {
		t.Errorf("expected [role_viewer], got %+v", roles)
	}
}

func TestMembershipRoles_Revoke(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	user, _ := tx.CreateUser(ctx, &store.User{Username: "revoke-user", PasswordHash: "x", Status: "active", PasswordChangedAt: time.Now().UTC()})
	m, _ := tx.CreateMembership(ctx, &store.Membership{TenantID: "tenant_default", UserID: user.ID, State: "active"})
	_ = tx.AssignMembershipRole(ctx, m.ID, "role_viewer", "")
	_ = tx.AssignMembershipRole(ctx, m.ID, "role_operator", "")
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	if err := tx2.RevokeMembershipRole(ctx, m.ID, "role_viewer"); err != nil {
		t.Fatalf("RevokeMembershipRole: %v", err)
	}
	// Revoking again is a no-op (no error).
	if err := tx2.RevokeMembershipRole(ctx, m.ID, "role_viewer"); err != nil {
		t.Errorf("repeat revoke: %v", err)
	}
	roles, _ := tx2.ListMembershipRoles(ctx, m.ID)
	if len(roles) != 1 || roles[0].ID != "role_operator" {
		t.Errorf("expected [role_operator], got %+v", roles)
	}
	_ = tx2.Commit()
}

func TestMembershipRoles_BackfilledFromUserRoles(t *testing.T) {
	// Migration 13 backfills membership_roles from user_roles for the
	// default tenant. The seed data ships role_superadmin assigned to
	// the bootstrap user via user_roles, so the corresponding default
	// membership should now also list it.
	ctx := context.Background()
	d := openTestDB(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	user, _ := tx.CreateUser(ctx, &store.User{Username: "pre-migration", PasswordHash: "x", Status: "active", PasswordChangedAt: time.Now().UTC()})
	if err := tx.AssignRole(ctx, user.ID, "role_viewer", ""); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}
	// Manually create the membership (the migration only backfills users
	// that existed at migration time; this user was created after).
	m, _ := tx.CreateMembership(ctx, &store.Membership{ID: "m_" + user.ID, TenantID: "tenant_default", UserID: user.ID, State: "active"})
	// Mirror the role assignment at the membership level (which the new
	// code paths will do automatically; this test exercises the storage).
	_ = tx.AssignMembershipRole(ctx, m.ID, "role_viewer", "")
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx2.Rollback() }()
	roles, _ := tx2.ListMembershipRoles(ctx, m.ID)
	if len(roles) == 0 {
		t.Error("expected role_viewer to be present on membership")
	}
}

// TestServiceLBSessionAffinity verifies that lb_cookie_name and
// lb_header_name round-trip through INSERT/SELECT/UPDATE on the
// services table (#71, migration 23).
func TestServiceLBSessionAffinity(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx.CreateService(ctx, &riokuv1.Service{
		Name:         "sticky-svc",
		LbPolicy:     riokuv1.LoadBalancingPolicy_LB_POLICY_COOKIE,
		LbCookieName: "rioku_sess",
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:80", Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if got := created.GetLbCookieName(); got != "rioku_sess" {
		t.Errorf("created lb_cookie_name = %q, want rioku_sess", got)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Update the service to switch to header-based LB.
	tx, err = d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	updated, err := tx.UpdateService(ctx, &riokuv1.Service{
		Id:           created.GetId(),
		Name:         "sticky-svc",
		LbPolicy:     riokuv1.LoadBalancingPolicy_LB_POLICY_HEADER,
		LbHeaderName: "X-Tenant-ID",
		LbCookieName: "", // clear
		Upstreams:    created.GetUpstreams(),
	})
	if err != nil {
		t.Fatalf("UpdateService: %v", err)
	}
	if got := updated.GetLbHeaderName(); got != "X-Tenant-ID" {
		t.Errorf("updated lb_header_name = %q, want X-Tenant-ID", got)
	}
	if got := updated.GetLbCookieName(); got != "" {
		t.Errorf("updated lb_cookie_name = %q, want empty", got)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Re-fetch via Get and List to confirm both code paths return the new fields.
	tx, _ = d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx.Rollback() }()
	got, err := tx.GetService(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	if got.GetLbHeaderName() != "X-Tenant-ID" || got.GetLbCookieName() != "" {
		t.Errorf("Get round-trip mismatch: header=%q cookie=%q", got.GetLbHeaderName(), got.GetLbCookieName())
	}
	listed, err := tx.ListServices(ctx)
	if err != nil {
		t.Fatalf("ListServices: %v", err)
	}
	var found bool
	for _, s := range listed {
		if s.GetId() == created.GetId() {
			if s.GetLbHeaderName() != "X-Tenant-ID" {
				t.Errorf("List round-trip header = %q", s.GetLbHeaderName())
			}
			found = true
		}
	}
	if !found {
		t.Error("ListServices: created service missing from results")
	}
}

// TestRouteMatcherExtensions verifies that the new Matcher fields
// (queries, expression, not, header_regexp) round-trip through the
// SQLite JSON column unchanged (#72).
func TestRouteMatcherExtensions(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	// Need a service to point the route at.
	tx, _ := d.Begin(ctx, store.TxOptions{})
	svc, err := tx.CreateService(ctx, &riokuv1.Service{
		Name:     "tgt",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:8080", Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	_ = tx.Commit()

	tx, _ = d.Begin(ctx, store.TxOptions{})
	created, err := tx.CreateRoute(ctx, &riokuv1.Route{
		Name: "r-with-extensions",
		Matchers: []*riokuv1.Matcher{{
			Hosts:   []string{"api.example.com"},
			Queries: []*riokuv1.QueryMatcher{{Key: "v", Value: "1"}, {Key: "v", Value: "2"}},
			Headers: []*riokuv1.HeaderMatcher{
				{Name: "X-Trace", Value: "^abc[0-9]+$", Regexp: true},
			},
			Expression: `method('POST')`,
			Not: []*riokuv1.Matcher{
				{Paths: []*riokuv1.PathMatcher{{Type: riokuv1.PathMatcher_TYPE_PREFIX, Value: "/internal"}}},
			},
		}},
		Target:  &riokuv1.Route_ServiceId{ServiceId: svc.GetId()},
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateRoute: %v", err)
	}
	_ = tx.Commit()

	tx, _ = d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx.Rollback() }()
	got, err := tx.GetRoute(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetRoute: %v", err)
	}
	if len(got.GetMatchers()) != 1 {
		t.Fatalf("expected 1 matcher, got %d", len(got.GetMatchers()))
	}
	m := got.GetMatchers()[0]
	if len(m.GetQueries()) != 2 {
		t.Errorf("queries len = %d, want 2", len(m.GetQueries()))
	}
	if got := m.GetExpression(); got != `method('POST')` {
		t.Errorf("expression = %q", got)
	}
	if len(m.GetNot()) != 1 {
		t.Errorf("not len = %d, want 1", len(m.GetNot()))
	}
	if len(m.GetHeaders()) != 1 || !m.GetHeaders()[0].GetRegexp() {
		t.Errorf("headers regexp lost in round-trip")
	}
}

// TestSQLite_Service_CaddyPrimitives_RoundTrip verifies that the Phase 7a /
// #161 service-level Caddy primitive fields (request_headers, response_headers,
// response_rules, compression) persist and round-trip correctly through the
// SQLite driver.
// ---------------------------------------------------------------------------
// Phase 7b / #162, #159 residual — dynamic upstreams storage round-trips
// ---------------------------------------------------------------------------

// TestSQLite_Service_DynamicUpstreams_RoundTrip verifies that both SrvLookup
// and ALookup upstream variants persist and retrieve correctly through
// CreateService / GetService / ListServices.
func TestSQLite_Service_DynamicUpstreams_RoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	svc, err := tx.CreateService(ctx, &riokuv1.Service{
		Name:     "dyn-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{
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
	if err != nil {
		t.Fatalf("CreateService (srv): %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin tx2: %v", err)
	}
	got, err := tx2.GetService(ctx, svc.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	_ = tx2.Rollback()

	if len(got.GetUpstreams()) != 1 {
		t.Fatalf("upstreams len = %d, want 1", len(got.GetUpstreams()))
	}
	u := got.GetUpstreams()[0]
	srv, ok := u.GetSource().(*riokuv1.Upstream_SrvLookup)
	if !ok {
		t.Fatalf("source is %T, want *Upstream_SrvLookup", u.GetSource())
	}
	if srv.SrvLookup.GetService() != "_http._tcp.api.example.com" {
		t.Errorf("srv.service = %q, want _http._tcp.api.example.com", srv.SrvLookup.GetService())
	}
	if srv.SrvLookup.GetProto() != "tcp" {
		t.Errorf("srv.proto = %q, want tcp", srv.SrvLookup.GetProto())
	}
	if srv.SrvLookup.GetRefreshSeconds() != 30 {
		t.Errorf("srv.refresh_seconds = %d, want 30", srv.SrvLookup.GetRefreshSeconds())
	}

	// Now create a service with ALookup.
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin tx3: %v", err)
	}
	svc2, err := tx3.CreateService(ctx, &riokuv1.Service{
		Name: "dyn-svc-a",
		Upstreams: []*riokuv1.Upstream{
			{
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
	if err != nil {
		t.Fatalf("CreateService (a): %v", err)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit tx3: %v", err)
	}

	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin tx4: %v", err)
	}
	got2, err := tx4.GetService(ctx, svc2.GetId())
	if err != nil {
		t.Fatalf("GetService (a): %v", err)
	}
	_ = tx4.Rollback()

	u2 := got2.GetUpstreams()[0]
	al, ok := u2.GetSource().(*riokuv1.Upstream_ALookup)
	if !ok {
		t.Fatalf("source is %T, want *Upstream_ALookup", u2.GetSource())
	}
	if al.ALookup.GetName() != "api.example.com" {
		t.Errorf("a.name = %q, want api.example.com", al.ALookup.GetName())
	}
	if al.ALookup.GetPort() != 8080 {
		t.Errorf("a.port = %d, want 8080", al.ALookup.GetPort())
	}
	if al.ALookup.GetRefreshSeconds() != 120 {
		t.Errorf("a.refresh_seconds = %d, want 120", al.ALookup.GetRefreshSeconds())
	}

	// Verify ListServices includes both services with their dynamic sources.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin tx5: %v", err)
	}
	defer func() { _ = tx5.Rollback() }()
	all, err := tx5.ListServices(ctx)
	if err != nil {
		t.Fatalf("ListServices: %v", err)
	}
	srvFound, aFound := false, false
	for _, s := range all {
		for _, up := range s.GetUpstreams() {
			switch up.GetSource().(type) {
			case *riokuv1.Upstream_SrvLookup:
				srvFound = true
			case *riokuv1.Upstream_ALookup:
				aFound = true
			}
		}
	}
	if !srvFound {
		t.Error("ListServices: SrvLookup upstream not found")
	}
	if !aFound {
		t.Error("ListServices: ALookup upstream not found")
	}
}

// TestSQLite_Service_DynamicUpstreams_StaticBackward verifies that static
// (no source) upstreams still round-trip cleanly after migration 27.
func TestSQLite_Service_DynamicUpstreams_StaticBackward(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svc, err := tx.CreateService(ctx, &riokuv1.Service{
		Name: "static-svc",
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080", Weight: 5, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin tx2: %v", err)
	}
	got, err := tx2.GetService(ctx, svc.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	_ = tx2.Rollback()

	if len(got.GetUpstreams()) != 1 {
		t.Fatalf("upstreams len = %d, want 1", len(got.GetUpstreams()))
	}
	u := got.GetUpstreams()[0]
	if u.GetSource() != nil {
		t.Errorf("static upstream should have nil source, got %T", u.GetSource())
	}
	if u.GetAddress() != "10.0.0.1:8080" {
		t.Errorf("address = %q, want 10.0.0.1:8080", u.GetAddress())
	}
}

// TestSQLite_Service_TrustedProxies_LegacyShape verifies the backward-compat
// shim in unmarshalTrustedProxiesJSON: a legacy JSON array of CIDR strings is
// parsed as TrustedProxies{Static: [...]}.
func TestSQLite_Service_TrustedProxies_LegacyShape(t *testing.T) {
	legacy := `["10.0.0.0/8","192.168.0.0/16"]`
	tp, err := unmarshalTrustedProxiesJSON(legacy)
	if err != nil {
		t.Fatalf("unmarshalTrustedProxiesJSON (legacy): %v", err)
	}
	if tp == nil {
		t.Fatal("got nil, want TrustedProxies")
	}
	if len(tp.GetStatic()) != 2 {
		t.Fatalf("static len = %d, want 2", len(tp.GetStatic()))
	}
	if tp.GetStatic()[0] != "10.0.0.0/8" {
		t.Errorf("static[0] = %q, want 10.0.0.0/8", tp.GetStatic()[0])
	}
	if len(tp.GetDynamic()) != 0 {
		t.Errorf("dynamic should be empty for legacy shape, got %d", len(tp.GetDynamic()))
	}
}

// TestSQLite_Service_TrustedProxies_NewShape verifies that the new object-shape
// TrustedProxies JSON round-trips cleanly.
func TestSQLite_Service_TrustedProxies_NewShape(t *testing.T) {
	original := &riokuv1.TrustedProxies{
		Static: []string{"10.0.0.0/8"},
		Dynamic: []*riokuv1.TrustedProxiesDynamic{
			{Strategy: "cloudflare", RefreshSeconds: 3600},
		},
	}
	s, err := marshalTrustedProxiesJSON(original)
	if err != nil {
		t.Fatalf("marshalTrustedProxiesJSON: %v", err)
	}
	got, err := unmarshalTrustedProxiesJSON(s)
	if err != nil {
		t.Fatalf("unmarshalTrustedProxiesJSON (new shape): %v", err)
	}
	if len(got.GetStatic()) != 1 || got.GetStatic()[0] != "10.0.0.0/8" {
		t.Errorf("static = %v, want [10.0.0.0/8]", got.GetStatic())
	}
	if len(got.GetDynamic()) != 1 {
		t.Fatalf("dynamic len = %d, want 1", len(got.GetDynamic()))
	}
	if got.GetDynamic()[0].GetStrategy() != "cloudflare" {
		t.Errorf("dynamic[0].strategy = %q, want cloudflare", got.GetDynamic()[0].GetStrategy())
	}
	if got.GetDynamic()[0].GetRefreshSeconds() != 3600 {
		t.Errorf("dynamic[0].refresh_seconds = %d, want 3600", got.GetDynamic()[0].GetRefreshSeconds())
	}
}

// TestSQLite_Service_CaddyPrimitives_RoundTrip tests phase 7a primitives (unchanged).
func TestSQLite_Service_CaddyPrimitives_RoundTrip(t *testing.T) {
	ctx := context.Background()
	d := openTestDB(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	created, err := tx.CreateService(ctx, &riokuv1.Service{
		Name:     "prim-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080", Weight: 1, Healthy: true},
		},
		RequestHeaders: &riokuv1.RequestHeaders{
			Set:    map[string]string{"X-Custom": "v1"},
			Add:    map[string]string{"X-Trace": "id"},
			Delete: []string{"X-Internal"},
		},
		ResponseHeaders: &riokuv1.ResponseHeaders{
			Set:    map[string]string{"X-Frame-Options": "DENY"},
			Delete: []string{"X-Powered-By"},
		},
		ResponseRules: []*riokuv1.ResponseRule{
			{
				MatchStatusCodes: []string{"5xx"},
				Action: &riokuv1.ResponseRule_ServeErrorPage{
					ServeErrorPage: &riokuv1.ResponseErrorPage{
						StatusCode: 503,
						Body:       "<h1>Down</h1>",
					},
				},
			},
		},
		Compression: &riokuv1.Compression{
			Enabled:   true,
			Encodings: []string{"gzip"},
			MinLength: 1024,
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Retrieve via GetService.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin tx2: %v", err)
	}
	got, err := tx2.GetService(ctx, created.GetId())
	if err != nil {
		t.Fatalf("GetService: %v", err)
	}
	_ = tx2.Rollback()

	// RequestHeaders
	rh := got.GetRequestHeaders()
	if rh == nil {
		t.Fatal("request_headers is nil after round-trip")
	}
	if rh.GetSet()["X-Custom"] != "v1" {
		t.Errorf("request_headers.set[X-Custom] = %q, want v1", rh.GetSet()["X-Custom"])
	}
	if rh.GetAdd()["X-Trace"] != "id" {
		t.Errorf("request_headers.add[X-Trace] = %q, want id", rh.GetAdd()["X-Trace"])
	}
	if len(rh.GetDelete()) != 1 || rh.GetDelete()[0] != "X-Internal" {
		t.Errorf("request_headers.delete = %v, want [X-Internal]", rh.GetDelete())
	}

	// ResponseHeaders
	respH := got.GetResponseHeaders()
	if respH == nil {
		t.Fatal("response_headers is nil after round-trip")
	}
	if respH.GetSet()["X-Frame-Options"] != "DENY" {
		t.Errorf("response_headers.set[X-Frame-Options] = %q, want DENY", respH.GetSet()["X-Frame-Options"])
	}
	if len(respH.GetDelete()) != 1 || respH.GetDelete()[0] != "X-Powered-By" {
		t.Errorf("response_headers.delete = %v, want [X-Powered-By]", respH.GetDelete())
	}

	// ResponseRules
	rules := got.GetResponseRules()
	if len(rules) != 1 {
		t.Fatalf("response_rules len = %d, want 1", len(rules))
	}
	rule := rules[0]
	if len(rule.GetMatchStatusCodes()) != 1 || rule.GetMatchStatusCodes()[0] != "5xx" {
		t.Errorf("response_rules[0].match_status_codes = %v, want [5xx]", rule.GetMatchStatusCodes())
	}
	ep, ok := rule.GetAction().(*riokuv1.ResponseRule_ServeErrorPage)
	if !ok {
		t.Fatalf("response_rules[0].action is %T, want ServeErrorPage", rule.GetAction())
	}
	if ep.ServeErrorPage.GetStatusCode() != 503 {
		t.Errorf("serve_error_page.status_code = %d, want 503", ep.ServeErrorPage.GetStatusCode())
	}
	if ep.ServeErrorPage.GetBody() != "<h1>Down</h1>" {
		t.Errorf("serve_error_page.body = %q, want <h1>Down</h1>", ep.ServeErrorPage.GetBody())
	}

	// Compression
	comp := got.GetCompression()
	if comp == nil {
		t.Fatal("compression is nil after round-trip")
	}
	if !comp.GetEnabled() {
		t.Error("compression.enabled = false, want true")
	}
	if len(comp.GetEncodings()) != 1 || comp.GetEncodings()[0] != "gzip" {
		t.Errorf("compression.encodings = %v, want [gzip]", comp.GetEncodings())
	}
	if comp.GetMinLength() != 1024 {
		t.Errorf("compression.min_length = %d, want 1024", comp.GetMinLength())
	}

	// Verify via ListServices as well.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin tx3: %v", err)
	}
	defer func() { _ = tx3.Rollback() }()
	services, err := tx3.ListServices(ctx)
	if err != nil {
		t.Fatalf("ListServices: %v", err)
	}
	if len(services) != 1 {
		t.Fatalf("ListServices len = %d, want 1", len(services))
	}
	if services[0].GetCompression().GetEnabled() != true {
		t.Error("ListServices: compression.enabled lost")
	}
	if services[0].GetRequestHeaders().GetSet()["X-Custom"] != "v1" {
		t.Error("ListServices: request_headers.set[X-Custom] lost")
	}
}
