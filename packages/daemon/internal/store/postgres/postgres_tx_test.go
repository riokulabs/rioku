package postgres_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/postgres"
)

// openPGTestDB opens a Postgres driver using POSTGRES_TEST_DSN, runs
// MigrateUp, and registers cleanup that runs MigrateDown then closes the
// driver. The test is skipped when POSTGRES_TEST_DSN is unset.
func openPGTestDB(t *testing.T) store.Driver {
	t.Helper()
	dsn := os.Getenv("POSTGRES_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_TEST_DSN not set; skipping Postgres integration test")
	}

	ctx := context.Background()
	d, err := store.New("postgres")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	if err := d.Open(ctx, store.DriverConfig{DSN: dsn}); err != nil {
		t.Fatalf("Open: %v", err)
	}

	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		_ = d.Close()
		t.Fatalf("MigrateUp: %v", err)
	}

	t.Cleanup(func() {
		_ = d.Migrate(context.Background(), store.MigrateDown)
		_ = d.Close()
	})

	return d
}

// TestRoute_CRUD exercises Create → Get → List → Update → Delete for routes,
// covering both Route_ServiceId and Route_Upstream target variants.
func TestRoute_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Create a backing service first so we can reference it via Route_ServiceId.
	txS, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svc, err := txS.CreateService(ctx, &riokuv1.Service{
		Name:     "route-test-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:8080", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if err := txS.Commit(); err != nil {
		t.Fatalf("Commit (service): %v", err)
	}

	// --- Create via Route_ServiceId ---
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

	// --- Create via Route_Upstream (direct upstream target) ---
	tx1b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	routeDirect, err := tx1b.CreateRoute(ctx, &riokuv1.Route{
		Name: "direct-upstream-route",
		Target: &riokuv1.Route_Upstream{
			Upstream: &riokuv1.DirectUpstream{Address: "10.0.0.99:9000"},
		},
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateRoute (direct upstream): %v", err)
	}
	if routeDirect.GetUpstream() == nil {
		t.Fatal("expected non-nil DirectUpstream target")
	}
	if routeDirect.GetUpstream().GetAddress() != "10.0.0.99:9000" {
		t.Fatalf("expected address '10.0.0.99:9000', got %q", routeDirect.GetUpstream().GetAddress())
	}
	if err := tx1b.Commit(); err != nil {
		t.Fatalf("Commit (direct upstream route): %v", err)
	}

	// --- Get ---
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

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	routes, err := tx3.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("ListRoutes: %v", err)
	}
	if len(routes) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(routes))
	}
	_ = tx3.Rollback()

	// --- Update ---
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

	// --- Delete ---
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

	// Verify deletion — only direct-upstream route remains.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	routes, err = tx6.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("ListRoutes after delete: %v", err)
	}
	if len(routes) != 1 {
		t.Fatalf("expected 1 route after delete, got %d", len(routes))
	}
	_ = tx6.Rollback()
}

// TestService_CRUD exercises Create → Get → List → Update (upstream replacement) → Delete.
// It also verifies the N+1-fix batch-upstream path in ListServices.
func TestService_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// --- Create ---
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

	// --- Get (with upstreams) ---
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
	foundUpstream := false
	for _, u := range got.GetUpstreams() {
		if u.GetAddress() == "10.0.0.1:80" {
			foundUpstream = true
			if u.GetWeight() != 3 {
				t.Fatalf("expected weight=3, got %d", u.GetWeight())
			}
			if u.GetTls() != riokuv1.TLSMode_TLS_MODE_AUTO {
				t.Fatalf("expected tls=AUTO, got %v", u.GetTls())
			}
			if !u.GetHealthy() {
				t.Fatal("expected healthy=true for 10.0.0.1:80")
			}
		}
	}
	if !foundUpstream {
		t.Fatal("upstream 10.0.0.1:80 not found")
	}
	_ = tx2.Rollback()

	// --- List (N+1 fix — batch upstream fetch) ---
	// Create a second service so the batch path exercises multiple rows.
	tx2b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	svc2, err := tx2b.CreateService(ctx, &riokuv1.Service{
		Name:     "second-service",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "192.168.1.1:443", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService (second): %v", err)
	}
	_ = svc2
	if err := tx2b.Commit(); err != nil {
		t.Fatalf("Commit (second service): %v", err)
	}

	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	services, err := tx3.ListServices(ctx)
	if err != nil {
		t.Fatalf("ListServices: %v", err)
	}
	if len(services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(services))
	}
	// All services must have their upstreams populated.
	for _, s := range services {
		if len(s.GetUpstreams()) == 0 {
			t.Fatalf("service %q has no upstreams in ListServices", s.GetName())
		}
	}
	_ = tx3.Rollback()

	// --- Update (upstream replacement) ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created.Name = "updated-service"
	created.Upstreams = []*riokuv1.Upstream{
		{Address: "10.0.0.3:80", Weight: 5, Healthy: true},
	}
	updatedSvc, err := tx4.UpdateService(ctx, created)
	if err != nil {
		t.Fatalf("UpdateService: %v", err)
	}
	if updatedSvc.GetName() != "updated-service" {
		t.Fatalf("expected name='updated-service', got %q", updatedSvc.GetName())
	}
	if len(updatedSvc.GetUpstreams()) != 1 {
		t.Fatalf("expected 1 upstream after update, got %d", len(updatedSvc.GetUpstreams()))
	}
	if updatedSvc.GetUpstreams()[0].GetAddress() != "10.0.0.3:80" {
		t.Fatalf("expected address 10.0.0.3:80, got %q", updatedSvc.GetUpstreams()[0].GetAddress())
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
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

	// Verify deletion.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	services, err = tx6.ListServices(ctx)
	if err != nil {
		t.Fatalf("ListServices after delete: %v", err)
	}
	if len(services) != 1 {
		t.Fatalf("expected 1 service after delete, got %d", len(services))
	}
	_ = tx6.Rollback()
}

// TestPolicy_CRUD exercises Create → Get → List → Update → Delete for policies.
func TestPolicy_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	cfg, err := structpb.NewStruct(map[string]any{
		"requests_per_second": 100,
		"burst":               10,
	})
	if err != nil {
		t.Fatalf("NewStruct: %v", err)
	}

	// --- Create ---
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
	if created.GetCreatedAt() == nil {
		t.Fatal("expected non-nil CreatedAt")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
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

	// --- List ---
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

	// --- Update ---
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

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeletePolicy(ctx, created.GetId()); err != nil {
		t.Fatalf("DeletePolicy: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify deletion.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	policies, err = tx6.ListPolicies(ctx)
	if err != nil {
		t.Fatalf("ListPolicies after delete: %v", err)
	}
	if len(policies) != 0 {
		t.Fatalf("expected 0 policies after delete, got %d", len(policies))
	}
	_ = tx6.Rollback()
}

// TestPolicyBindings exercises AttachPolicy → ListPoliciesByTarget → DetachPolicy.
func TestPolicyBindings(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Create a policy.
	txP, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	pol, err := txP.CreatePolicy(ctx, &riokuv1.Policy{
		Name: "binding-test-policy",
		Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
	})
	if err != nil {
		t.Fatalf("CreatePolicy: %v", err)
	}
	if err := txP.Commit(); err != nil {
		t.Fatalf("Commit (policy): %v", err)
	}

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
		t.Fatalf("Commit (service): %v", err)
	}

	// --- Attach ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx1.AttachPolicy(ctx, pol.GetId(), "service", svc.GetId()); err != nil {
		t.Fatalf("AttachPolicy: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit (attach): %v", err)
	}

	// --- ListPoliciesByTarget ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	policyIDs, err := tx2.ListPoliciesByTarget(ctx, "service", svc.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget: %v", err)
	}
	if len(policyIDs) != 1 || policyIDs[0] != pol.GetId() {
		t.Fatalf("expected [%s], got %v", pol.GetId(), policyIDs)
	}
	_ = tx2.Rollback()

	// --- AttachPolicy with invalid target_type is rejected ---
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx3.AttachPolicy(ctx, pol.GetId(), "invalid_type", svc.GetId()); err == nil {
		t.Fatal("expected error for invalid target_type, got nil")
	}
	_ = tx3.Rollback()

	// --- Detach ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.DetachPolicy(ctx, pol.GetId(), "service", svc.GetId()); err != nil {
		t.Fatalf("DetachPolicy: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit (detach): %v", err)
	}

	// --- Verify empty after detach ---
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	policyIDs, err = tx5.ListPoliciesByTarget(ctx, "service", svc.GetId())
	if err != nil {
		t.Fatalf("ListPoliciesByTarget after detach: %v", err)
	}
	if len(policyIDs) != 0 {
		t.Fatalf("expected 0 policy IDs after detach, got %d", len(policyIDs))
	}
	_ = tx5.Rollback()

	// --- DetachPolicy on missing binding returns error ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DetachPolicy(ctx, pol.GetId(), "service", svc.GetId()); err == nil {
		t.Fatal("expected error when detaching non-existent binding, got nil")
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

// TestAPIKey_CRUD exercises Create → Get → GetByHash → List → ListByOwner →
// Revoke → Update (partial) → RecordUse round-trip.
func TestAPIKey_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	expiry := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Millisecond)

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	id, err := tx1.CreateAPIKey(ctx, "test-key", "hash-abc123", []string{"read", "write"}, &expiry, "owner-user-1")
	if err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty id")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	key, err := tx2.GetAPIKey(ctx, id)
	if err != nil {
		t.Fatalf("GetAPIKey: %v", err)
	}
	if key.Name != "test-key" {
		t.Fatalf("expected name 'test-key', got %q", key.Name)
	}
	if key.KeyHash != "hash-abc123" {
		t.Fatalf("expected hash 'hash-abc123', got %q", key.KeyHash)
	}
	if len(key.Scopes) != 2 {
		t.Fatalf("expected 2 scopes, got %d", len(key.Scopes))
	}
	if key.OwnerID != "owner-user-1" {
		t.Fatalf("expected owner 'owner-user-1', got %q", key.OwnerID)
	}
	if key.ExpiresAt == nil {
		t.Fatal("expected non-nil ExpiresAt")
	}
	if key.RevokedAt != nil {
		t.Fatal("expected nil RevokedAt")
	}
	_ = tx2.Rollback()

	// --- GetByHash (no tenant filter) ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	keyByHash, err := tx3.GetAPIKeyByHash(ctx, "hash-abc123")
	if err != nil {
		t.Fatalf("GetAPIKeyByHash: %v", err)
	}
	if keyByHash.ID != id {
		t.Fatalf("expected id=%q, got %q", id, keyByHash.ID)
	}
	_ = tx3.Rollback()

	// --- List ---
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

	// --- ListByOwner ---
	tx4b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ownerKeys, err := tx4b.ListAPIKeysByOwner(ctx, "owner-user-1")
	if err != nil {
		t.Fatalf("ListAPIKeysByOwner: %v", err)
	}
	if len(ownerKeys) != 1 {
		t.Fatalf("expected 1 key by owner, got %d", len(ownerKeys))
	}
	_ = tx4b.Rollback()

	// --- Update (partial — name only) ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newName := "renamed-key"
	updated, err := tx5.UpdateAPIKey(ctx, id, store.UpdateAPIKeyParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateAPIKey: %v", err)
	}
	if updated.Name != "renamed-key" {
		t.Fatalf("expected name 'renamed-key', got %q", updated.Name)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Update (clear expiry) ---
	tx5b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	var nilTime *time.Time
	cleared, err := tx5b.UpdateAPIKey(ctx, id, store.UpdateAPIKeyParams{ExpiresAt: &nilTime})
	if err != nil {
		t.Fatalf("UpdateAPIKey (clear expiry): %v", err)
	}
	if cleared.ExpiresAt != nil {
		t.Fatal("expected nil ExpiresAt after clear")
	}
	if err := tx5b.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- RecordAPIKeyUse ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.RecordAPIKeyUse(ctx, id, time.Now()); err != nil {
		t.Fatalf("RecordAPIKeyUse: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify usage count bumped.
	tx6b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterUse, err := tx6b.GetAPIKey(ctx, id)
	if err != nil {
		t.Fatalf("GetAPIKey after use: %v", err)
	}
	if afterUse.UsageCount != 1 {
		t.Fatalf("expected usage_count=1, got %d", afterUse.UsageCount)
	}
	if afterUse.LastUsedAt == nil {
		t.Fatal("expected non-nil LastUsedAt after use")
	}
	_ = tx6b.Rollback()

	// --- Revoke ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.RevokeAPIKey(ctx, id); err != nil {
		t.Fatalf("RevokeAPIKey: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Revoking again should error.
	tx7b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7b.RevokeAPIKey(ctx, id); err == nil {
		t.Fatal("expected error revoking already-revoked key, got nil")
	}
	_ = tx7b.Rollback()

	// Revoked key should no longer appear in ListAPIKeys.
	tx8, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	keys, err = tx8.ListAPIKeys(ctx)
	if err != nil {
		t.Fatalf("ListAPIKeys after revoke: %v", err)
	}
	if len(keys) != 0 {
		t.Fatalf("expected 0 active keys after revoke, got %d", len(keys))
	}
	_ = tx8.Rollback()
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

// TestUser_CRUD exercises Create → Get → GetByUsername → List → Update →
// Delete; FailedAttempts increment/reset; UpdateLastLogin.
func TestUser_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	email := "alice@example.com"
	display := "Alice"

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateUser(ctx, &store.User{
		Username:     "Alice",
		Email:        &email,
		DisplayName:  &display,
		PasswordHash: "hashed-pw",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Username != "alice" { // stored lowercase
		t.Fatalf("expected username 'alice', got %q", created.Username)
	}
	if created.Email == nil || *created.Email != "alice@example.com" {
		t.Fatalf("expected email 'alice@example.com', got %v", created.Email)
	}
	if created.TOTPEnabled {
		t.Fatal("expected totp_enabled=false")
	}
	if created.ForcePasswordChange {
		t.Fatal("expected force_password_change=false")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetUser ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetUser(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if got.Username != "alice" {
		t.Fatalf("GetUser: expected 'alice', got %q", got.Username)
	}
	_ = tx2.Rollback()

	// --- GetUserByUsername (case-insensitive) ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	gotByUsername, err := tx3.GetUserByUsername(ctx, "ALICE")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if gotByUsername.ID != created.ID {
		t.Fatalf("expected id=%q, got %q", created.ID, gotByUsername.ID)
	}
	_ = tx3.Rollback()

	// --- ListUsers ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	users, err := tx4.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("expected 1 user, got %d", len(users))
	}
	_ = tx4.Rollback()

	// --- UpdateUser ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created.PasswordHash = "new-hashed-pw"
	created.ForcePasswordChange = true
	updated, err := tx5.UpdateUser(ctx, created)
	if err != nil {
		t.Fatalf("UpdateUser: %v", err)
	}
	if updated.PasswordHash != "new-hashed-pw" {
		t.Fatalf("expected updated password hash, got %q", updated.PasswordHash)
	}
	if !updated.ForcePasswordChange {
		t.Fatal("expected force_password_change=true")
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- IncrementFailedAttempts (without lock) ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.IncrementFailedAttempts(ctx, created.ID, nil); err != nil {
		t.Fatalf("IncrementFailedAttempts: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterIncr, err := tx6b.GetUser(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if afterIncr.FailedAttempts != 1 {
		t.Fatalf("expected failed_attempts=1, got %d", afterIncr.FailedAttempts)
	}
	_ = tx6b.Rollback()

	// --- IncrementFailedAttempts (with lock) ---
	lockUntil := time.Now().UTC().Add(10 * time.Minute)
	tx6c, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6c.IncrementFailedAttempts(ctx, created.ID, &lockUntil); err != nil {
		t.Fatalf("IncrementFailedAttempts (with lock): %v", err)
	}
	if err := tx6c.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6d, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterLock, err := tx6d.GetUser(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if afterLock.FailedAttempts != 2 {
		t.Fatalf("expected failed_attempts=2, got %d", afterLock.FailedAttempts)
	}
	if afterLock.Status != "locked" {
		t.Fatalf("expected status='locked', got %q", afterLock.Status)
	}
	if afterLock.LockedUntil == nil {
		t.Fatal("expected non-nil LockedUntil")
	}
	_ = tx6d.Rollback()

	// --- ResetFailedAttempts ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.ResetFailedAttempts(ctx, created.ID); err != nil {
		t.Fatalf("ResetFailedAttempts: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx7b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterReset, err := tx7b.GetUser(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if afterReset.FailedAttempts != 0 {
		t.Fatalf("expected failed_attempts=0, got %d", afterReset.FailedAttempts)
	}
	if afterReset.Status != "active" {
		t.Fatalf("expected status='active', got %q", afterReset.Status)
	}
	if afterReset.LockedUntil != nil {
		t.Fatal("expected nil LockedUntil after reset")
	}
	_ = tx7b.Rollback()

	// --- UpdateLastLogin ---
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx8.UpdateLastLogin(ctx, created.ID); err != nil {
		t.Fatalf("UpdateLastLogin: %v", err)
	}
	if err := tx8.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx8b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterLogin, err := tx8b.GetUser(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if afterLogin.LastLogin == nil {
		t.Fatal("expected non-nil LastLogin after UpdateLastLogin")
	}
	_ = tx8b.Rollback()

	// --- DeleteUser ---
	tx9, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx9.DeleteUser(ctx, created.ID); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	if err := tx9.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx9b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	users, err = tx9b.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers after delete: %v", err)
	}
	if len(users) != 0 {
		t.Fatalf("expected 0 users after delete, got %d", len(users))
	}
	_ = tx9b.Rollback()
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

// TestSession_CRUD exercises Create → Get → ListByUser → Delete →
// DeleteByUser → DeleteByUserExcept → UpdateLastActive → DeleteExpired.
func TestSession_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	now := time.Now().UTC().Truncate(time.Millisecond)

	// --- Create ---
	ip := "127.0.0.1"
	ua := "test-agent/1.0"
	sess := &store.Session{
		ID:          "sess-test-001",
		UserID:      "user-abc",
		Fingerprint: "fp-xyz",
		CreatedAt:   now,
		ExpiresAt:   now.Add(time.Hour),
		LastActive:  now,
		IPAddress:   &ip,
		UserAgent:   &ua,
	}

	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateSession(ctx, sess)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if created.ID != "sess-test-001" {
		t.Fatalf("expected id='sess-test-001', got %q", created.ID)
	}
	if created.UserID != "user-abc" {
		t.Fatalf("expected user_id='user-abc', got %q", created.UserID)
	}
	if created.IPAddress == nil || *created.IPAddress != "127.0.0.1" {
		t.Fatalf("expected ip='127.0.0.1', got %v", created.IPAddress)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetSession(ctx, "sess-test-001")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.Fingerprint != "fp-xyz" {
		t.Fatalf("expected fingerprint='fp-xyz', got %q", got.Fingerprint)
	}
	_ = tx2.Rollback()

	// --- Create a second session for the same user ---
	sess2 := &store.Session{
		ID:          "sess-test-002",
		UserID:      "user-abc",
		Fingerprint: "fp-zzz",
		CreatedAt:   now,
		ExpiresAt:   now.Add(time.Hour),
		LastActive:  now,
	}
	tx2b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx2b.CreateSession(ctx, sess2); err != nil {
		t.Fatalf("CreateSession (second): %v", err)
	}
	if err := tx2b.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ListByUser ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sessions, err := tx3.ListSessionsByUser(ctx, "user-abc")
	if err != nil {
		t.Fatalf("ListSessionsByUser: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
	_ = tx3.Rollback()

	// --- UpdateLastActive ---
	newActive := now.Add(30 * time.Minute)
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.UpdateSessionLastActive(ctx, "sess-test-001", newActive); err != nil {
		t.Fatalf("UpdateSessionLastActive: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx4b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterUpdate, err := tx4b.GetSession(ctx, "sess-test-001")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if !afterUpdate.LastActive.Equal(newActive) {
		t.Fatalf("expected last_active=%v, got %v", newActive, afterUpdate.LastActive)
	}
	_ = tx4b.Rollback()

	// --- DeleteSessionsByUserExcept (keep sess-test-001, remove sess-test-002) ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteSessionsByUserExcept(ctx, "user-abc", "sess-test-001"); err != nil {
		t.Fatalf("DeleteSessionsByUserExcept: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx5b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sessions, err = tx5b.ListSessionsByUser(ctx, "user-abc")
	if err != nil {
		t.Fatalf("ListSessionsByUser after DeleteExcept: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session after DeleteExcept, got %d", len(sessions))
	}
	if sessions[0].ID != "sess-test-001" {
		t.Fatalf("expected sess-test-001 to survive, got %q", sessions[0].ID)
	}
	_ = tx5b.Rollback()

	// --- DeleteSession ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteSession(ctx, "sess-test-001"); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Create two more to test DeleteSessionsByUser + DeleteExpired.
	sess3 := &store.Session{ID: "sess-test-003", UserID: "user-abc", Fingerprint: "fp-3", CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastActive: now}
	sess4 := &store.Session{ID: "sess-test-004", UserID: "user-abc", Fingerprint: "fp-4", CreatedAt: now, ExpiresAt: now.Add(-2 * time.Hour), LastActive: now.Add(-25 * time.Hour)} // already expired
	for _, s := range []*store.Session{sess3, sess4} {
		txC, err := d.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("Begin: %v", err)
		}
		if _, err := txC.CreateSession(ctx, s); err != nil {
			t.Fatalf("CreateSession: %v", err)
		}
		if err := txC.Commit(); err != nil {
			t.Fatalf("Commit: %v", err)
		}
	}

	// --- DeleteExpiredSessions ---
	txE, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	n, err := txE.DeleteExpiredSessions(ctx)
	if err != nil {
		t.Fatalf("DeleteExpiredSessions: %v", err)
	}
	if n < 1 {
		t.Fatalf("expected >= 1 expired session deleted, got %d", n)
	}
	if err := txE.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- DeleteSessionsByUser ---
	txD, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := txD.DeleteSessionsByUser(ctx, "user-abc"); err != nil {
		t.Fatalf("DeleteSessionsByUser: %v", err)
	}
	if err := txD.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txFinal, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sessions, err = txFinal.ListSessionsByUser(ctx, "user-abc")
	if err != nil {
		t.Fatalf("ListSessionsByUser after DeleteByUser: %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions after DeleteByUser, got %d", len(sessions))
	}
	_ = txFinal.Rollback()
}

// ---------------------------------------------------------------------------
// Config Versions
// ---------------------------------------------------------------------------

// TestConfigVersion_CRUD exercises Save (monotonically increasing version) →
// Get → List → Latest.
func TestConfigVersion_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// --- Save first version ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	v1, err := tx1.SaveConfigVersion(ctx, []byte(`{"version":1}`), "admin")
	if err != nil {
		t.Fatalf("SaveConfigVersion: %v", err)
	}
	if v1 <= 0 {
		t.Fatalf("expected positive version, got %d", v1)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Save second version (must be > first) ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	v2, err := tx2.SaveConfigVersion(ctx, []byte(`{"version":2}`), "operator")
	if err != nil {
		t.Fatalf("SaveConfigVersion (v2): %v", err)
	}
	if v2 <= v1 {
		t.Fatalf("expected v2 > v1 (%d), got %d", v1, v2)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetConfigVersion ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	cv, err := tx3.GetConfigVersion(ctx, v1)
	if err != nil {
		t.Fatalf("GetConfigVersion: %v", err)
	}
	if cv.Version != v1 {
		t.Fatalf("expected version=%d, got %d", v1, cv.Version)
	}
	if cv.Actor != "admin" {
		t.Fatalf("expected actor='admin', got %q", cv.Actor)
	}
	if string(cv.Snapshot) != `{"version":1}` {
		t.Fatalf("unexpected snapshot: %s", cv.Snapshot)
	}
	_ = tx3.Rollback()

	// --- ListConfigVersions (DESC order) ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	versions, err := tx4.ListConfigVersions(ctx, 10)
	if err != nil {
		t.Fatalf("ListConfigVersions: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("expected 2 versions, got %d", len(versions))
	}
	if versions[0].Version <= versions[1].Version {
		t.Fatal("expected descending order")
	}
	_ = tx4.Rollback()

	// --- LatestConfigVersion ---
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	latest, err := tx5.LatestConfigVersion(ctx)
	if err != nil {
		t.Fatalf("LatestConfigVersion: %v", err)
	}
	if latest != v2 {
		t.Fatalf("expected latest=%d, got %d", v2, latest)
	}
	_ = tx5.Rollback()
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

// TestAuditLog exercises Append → Query (with various filters) →
// Count → GetEntry → ListActors → ListResourceIDs.
func TestAuditLog(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	now := time.Now().UTC()
	past := now.Add(-time.Hour)

	// Append two entries.
	for _, e := range []*riokuv1.AuditEntry{
		{
			Actor:      "alice",
			EntityType: "route",
			EntityId:   "route-001",
			Operation:  "CREATE",
			Diff:       "{}",
			OccurredAt: timestamppb.New(past),
		},
		{
			Actor:      "bob",
			EntityType: "service",
			EntityId:   "svc-001",
			Operation:  "UPDATE",
			Diff:       `{"name":"changed"}`,
			OccurredAt: timestamppb.New(now),
		},
	} {
		txA, err := d.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("Begin: %v", err)
		}
		if err := txA.AppendAuditEntry(ctx, e); err != nil {
			t.Fatalf("AppendAuditEntry: %v", err)
		}
		if err := txA.Commit(); err != nil {
			t.Fatalf("Commit: %v", err)
		}
	}

	// --- QueryAuditLog (no filter) ---
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	entries, err := tx1.QueryAuditLog(ctx, store.AuditQuery{Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	// DESC order — bob's entry should be first.
	if entries[0].Actor != "bob" {
		t.Fatalf("expected first entry actor='bob', got %q", entries[0].Actor)
	}
	_ = tx1.Rollback()

	// --- QueryAuditLog (filter by actor) ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	aliceEntries, err := tx2.QueryAuditLog(ctx, store.AuditQuery{Actor: "alice", Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog (actor filter): %v", err)
	}
	if len(aliceEntries) != 1 || aliceEntries[0].Actor != "alice" {
		t.Fatalf("expected 1 entry for alice, got %d", len(aliceEntries))
	}
	_ = tx2.Rollback()

	// --- QueryAuditLog (filter by entity_type) ---
	tx2b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	routeEntries, err := tx2b.QueryAuditLog(ctx, store.AuditQuery{EntityType: "route", Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog (entity_type filter): %v", err)
	}
	if len(routeEntries) != 1 {
		t.Fatalf("expected 1 route entry, got %d", len(routeEntries))
	}
	_ = tx2b.Rollback()

	// --- QueryAuditLog (filter by Since) ---
	tx2c, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	halfHourAgo := now.Add(-30 * time.Minute)
	recentEntries, err := tx2c.QueryAuditLog(ctx, store.AuditQuery{Since: &halfHourAgo, Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog (Since filter): %v", err)
	}
	if len(recentEntries) != 1 {
		t.Fatalf("expected 1 recent entry, got %d", len(recentEntries))
	}
	if recentEntries[0].Actor != "bob" {
		t.Fatalf("expected actor='bob', got %q", recentEntries[0].Actor)
	}
	_ = tx2c.Rollback()

	// --- CountAuditLog ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	total, err := tx3.CountAuditLog(ctx, store.AuditQuery{})
	if err != nil {
		t.Fatalf("CountAuditLog: %v", err)
	}
	if total != 2 {
		t.Fatalf("expected count=2, got %d", total)
	}
	aliceCount, err := tx3.CountAuditLog(ctx, store.AuditQuery{Actor: "alice"})
	if err != nil {
		t.Fatalf("CountAuditLog (alice): %v", err)
	}
	if aliceCount != 1 {
		t.Fatalf("expected alice count=1, got %d", aliceCount)
	}
	_ = tx3.Rollback()

	// --- GetAuditEntry ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	// Get the id of alice's entry from the query result.
	aliceID := aliceEntries[0].GetId()
	entry, err := tx4.GetAuditEntry(ctx, aliceID)
	if err != nil {
		t.Fatalf("GetAuditEntry: %v", err)
	}
	if entry.Actor != "alice" {
		t.Fatalf("expected actor='alice', got %q", entry.Actor)
	}
	if entry.EntityId != "route-001" {
		t.Fatalf("expected entity_id='route-001', got %q", entry.EntityId)
	}
	_ = tx4.Rollback()

	// GetAuditEntry for non-existent id should error.
	tx4b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx4b.GetAuditEntry(ctx, "does-not-exist"); err == nil {
		t.Fatal("expected error for missing audit entry, got nil")
	}
	_ = tx4b.Rollback()

	// --- ListAuditActors ---
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	actors, err := tx5.ListAuditActors(ctx, "", 100)
	if err != nil {
		t.Fatalf("ListAuditActors: %v", err)
	}
	if len(actors) != 2 {
		t.Fatalf("expected 2 actors, got %d", len(actors))
	}
	// With prefix filter.
	aliceActors, err := tx5.ListAuditActors(ctx, "al", 100)
	if err != nil {
		t.Fatalf("ListAuditActors (prefix): %v", err)
	}
	if len(aliceActors) != 1 || aliceActors[0] != "alice" {
		t.Fatalf("expected ['alice'], got %v", aliceActors)
	}
	_ = tx5.Rollback()

	// --- ListAuditResourceIDs ---
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	allIDs, err := tx6.ListAuditResourceIDs(ctx, "", "", 100)
	if err != nil {
		t.Fatalf("ListAuditResourceIDs: %v", err)
	}
	if len(allIDs) != 2 {
		t.Fatalf("expected 2 resource IDs, got %d", len(allIDs))
	}
	// Filter by entity_type.
	routeIDs, err := tx6.ListAuditResourceIDs(ctx, "route", "", 100)
	if err != nil {
		t.Fatalf("ListAuditResourceIDs (entity_type): %v", err)
	}
	if len(routeIDs) != 1 || routeIDs[0] != "route-001" {
		t.Fatalf("expected ['route-001'], got %v", routeIDs)
	}
	// Filter by prefix.
	routePrefixIDs, err := tx6.ListAuditResourceIDs(ctx, "", "route-", 100)
	if err != nil {
		t.Fatalf("ListAuditResourceIDs (prefix): %v", err)
	}
	if len(routePrefixIDs) != 1 {
		t.Fatalf("expected 1 ID matching prefix 'route-', got %d", len(routePrefixIDs))
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

// TestRole_CRUD exercises Create → Get → List → Update (name, desc, perms) →
// Delete. Also verifies ErrRoleImmutable on role_superadmin and
// ErrRoleNotFound on a missing ID.
func TestRole_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	roleID := "role-test-001"

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateRole(ctx, store.CreateRoleParams{
		ID:          roleID,
		Name:        "Test Role",
		Description: "A test role",
		Permissions: []string{"routes:read"},
	})
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}
	if created.ID != roleID {
		t.Fatalf("expected id=%q, got %q", roleID, created.ID)
	}
	if created.Name != "Test Role" {
		t.Fatalf("expected name='Test Role', got %q", created.Name)
	}
	if created.IsBuiltin {
		t.Fatal("expected is_builtin=false for a custom role")
	}
	if len(created.Permissions) != 1 || created.Permissions[0] != "routes:read" {
		t.Fatalf("expected permissions=['routes:read'], got %v", created.Permissions)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetRole(ctx, roleID)
	if err != nil {
		t.Fatalf("GetRole: %v", err)
	}
	if got.Name != "Test Role" {
		t.Fatalf("GetRole: expected name='Test Role', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	roles, err := tx3.ListRoles(ctx)
	if err != nil {
		t.Fatalf("ListRoles: %v", err)
	}
	found := false
	for _, r := range roles {
		if r.ID == roleID {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected role %q in ListRoles result", roleID)
	}
	_ = tx3.Rollback()

	// --- Update: name + add/remove perms ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newName := "Updated Role"
	newDesc := "Updated description"
	updated, err := tx4.UpdateRole(ctx, roleID, store.UpdateRoleParams{
		Name:        &newName,
		Description: &newDesc,
		AddPerms:    []string{"routes:write"},
		RemovePerms: []string{"routes:read"},
	})
	if err != nil {
		t.Fatalf("UpdateRole: %v", err)
	}
	if updated.Name != "Updated Role" {
		t.Fatalf("expected name='Updated Role', got %q", updated.Name)
	}
	if updated.Description != "Updated description" {
		t.Fatalf("expected desc='Updated description', got %q", updated.Description)
	}
	// Should have routes:write, not routes:read.
	if len(updated.Permissions) != 1 || updated.Permissions[0] != "routes:write" {
		t.Fatalf("expected permissions=['routes:write'], got %v", updated.Permissions)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrRoleImmutable on UpdateRole ---
	tx4b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx4b.UpdateRole(ctx, "role_superadmin", store.UpdateRoleParams{}); !errors.Is(err, store.ErrRoleImmutable) {
		t.Fatalf("expected ErrRoleImmutable, got %v", err)
	}
	_ = tx4b.Rollback()

	// --- ErrRoleNotFound on GetRole ---
	tx4c, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx4c.GetRole(ctx, "role-does-not-exist"); !errors.Is(err, store.ErrRoleNotFound) {
		t.Fatalf("expected ErrRoleNotFound, got %v", err)
	}
	_ = tx4c.Rollback()

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteRole(ctx, roleID); err != nil {
		t.Fatalf("DeleteRole: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// ErrRoleImmutable on DeleteRole.
	tx5b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5b.DeleteRole(ctx, "role_superadmin"); !errors.Is(err, store.ErrRoleImmutable) {
		t.Fatalf("expected ErrRoleImmutable on DeleteRole, got %v", err)
	}
	_ = tx5b.Rollback()

	// After delete — ErrRoleNotFound.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetRole(ctx, roleID); !errors.Is(err, store.ErrRoleNotFound) {
		t.Fatalf("expected ErrRoleNotFound after delete, got %v", err)
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

// TestPermissions_List verifies that at least one permission is returned from
// the seed data and that wildcard entries are excluded.
func TestPermissions_List(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	perms, err := tx1.ListPermissions(ctx)
	if err != nil {
		t.Fatalf("ListPermissions: %v", err)
	}
	if len(perms) == 0 {
		t.Fatal("expected at least one permission from seed data")
	}
	// Verify wildcard IDs are excluded.
	for _, p := range perms {
		if p.ID == "*" || strings.HasSuffix(p.ID, ":*") {
			t.Fatalf("unexpected wildcard permission in list: %q", p.ID)
		}
		if p.ID == "" {
			t.Fatal("expected non-empty permission ID")
		}
	}
	_ = tx1.Rollback()
}

// ---------------------------------------------------------------------------
// User Roles
// ---------------------------------------------------------------------------

// TestUserRoles exercises Assign → ListUserRoles → ListUsersWithRole → Revoke
// and verifies that AssignRole is idempotent (double-assign does not error).
func TestUserRoles(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Create a custom role to use in this test.
	roleID := "role-user-roles-test"
	txR, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := txR.CreateRole(ctx, store.CreateRoleParams{
		ID:   roleID,
		Name: "UserRoles Test Role",
	}); err != nil {
		t.Fatalf("CreateRole: %v", err)
	}
	if err := txR.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	userID := "user-roles-test-user-001"
	grantor := "admin-user-001"

	// --- Assign ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx1.AssignRole(ctx, userID, roleID, grantor); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Assign again (idempotent — must not error) ---
	tx1b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx1b.AssignRole(ctx, userID, roleID, grantor); err != nil {
		t.Fatalf("AssignRole (idempotent): %v", err)
	}
	if err := tx1b.Commit(); err != nil {
		t.Fatalf("Commit (idempotent): %v", err)
	}

	// --- ListUserRoles ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	userRoles, err := tx2.ListUserRoles(ctx, userID)
	if err != nil {
		t.Fatalf("ListUserRoles: %v", err)
	}
	if len(userRoles) != 1 {
		t.Fatalf("expected 1 user role, got %d", len(userRoles))
	}
	if userRoles[0].RoleID != roleID {
		t.Fatalf("expected role_id=%q, got %q", roleID, userRoles[0].RoleID)
	}
	if userRoles[0].GrantedBy != grantor {
		t.Fatalf("expected granted_by=%q, got %q", grantor, userRoles[0].GrantedBy)
	}
	if userRoles[0].GrantedAt.IsZero() {
		t.Fatal("expected non-zero granted_at")
	}
	_ = tx2.Rollback()

	// --- ListUsersWithRole ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	users, err := tx3.ListUsersWithRole(ctx, roleID)
	if err != nil {
		t.Fatalf("ListUsersWithRole: %v", err)
	}
	if len(users) != 1 || users[0] != userID {
		t.Fatalf("expected [%q], got %v", userID, users)
	}
	_ = tx3.Rollback()

	// --- Revoke ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.RevokeRole(ctx, userID, roleID); err != nil {
		t.Fatalf("RevokeRole: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify empty after revoke.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterRevoke, err := tx5.ListUserRoles(ctx, userID)
	if err != nil {
		t.Fatalf("ListUserRoles after revoke: %v", err)
	}
	if len(afterRevoke) != 0 {
		t.Fatalf("expected 0 roles after revoke, got %d", len(afterRevoke))
	}
	_ = tx5.Rollback()
}

// ---------------------------------------------------------------------------
// GetUserScopes
// ---------------------------------------------------------------------------

// TestGetUserScopes assigns two roles with distinct permissions to a user and
// verifies that GetUserScopes returns the union via the JOIN.
func TestGetUserScopes(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Create two roles with different permissions.
	roleAID := "role-scopes-a"
	roleBID := "role-scopes-b"

	txR, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := txR.CreateRole(ctx, store.CreateRoleParams{
		ID:          roleAID,
		Name:        "Scopes Role A",
		Permissions: []string{"routes:read"},
	}); err != nil {
		t.Fatalf("CreateRole A: %v", err)
	}
	if _, err := txR.CreateRole(ctx, store.CreateRoleParams{
		ID:          roleBID,
		Name:        "Scopes Role B",
		Permissions: []string{"services:read", "services:write"},
	}); err != nil {
		t.Fatalf("CreateRole B: %v", err)
	}
	if err := txR.Commit(); err != nil {
		t.Fatalf("Commit (roles): %v", err)
	}

	userID := "user-scopes-test-001"

	// Assign both roles to the user.
	txA, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := txA.AssignRole(ctx, userID, roleAID, ""); err != nil {
		t.Fatalf("AssignRole A: %v", err)
	}
	if err := txA.AssignRole(ctx, userID, roleBID, ""); err != nil {
		t.Fatalf("AssignRole B: %v", err)
	}
	if err := txA.Commit(); err != nil {
		t.Fatalf("Commit (assign): %v", err)
	}

	// Verify aggregated scopes.
	txS, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	scopes, err := txS.GetUserScopes(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserScopes: %v", err)
	}
	if len(scopes) != 3 {
		t.Fatalf("expected 3 scopes, got %d: %v", len(scopes), scopes)
	}
	scopeSet := make(map[string]bool, len(scopes))
	for _, s := range scopes {
		scopeSet[s] = true
	}
	for _, want := range []string{"routes:read", "services:read", "services:write"} {
		if !scopeSet[want] {
			t.Fatalf("expected scope %q in result, got %v", want, scopes)
		}
	}
	_ = txS.Rollback()
}

// ---------------------------------------------------------------------------
// TOTP Backup Codes
// ---------------------------------------------------------------------------

// TestTOTPBackupCodes exercises Create (verifies previous codes replaced) →
// ListUnused → MarkUsed → ListUnused (excludes marked) → Delete.
func TestTOTPBackupCodes(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	userID := "user-totp-test-001"

	// --- Create first batch ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx1.CreateTOTPBackupCodes(ctx, userID, []string{"hash1", "hash2", "hash3"}); err != nil {
		t.Fatalf("CreateTOTPBackupCodes: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify 3 unused codes.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	codes, err := tx2.ListUnusedTOTPBackupCodes(ctx, userID)
	if err != nil {
		t.Fatalf("ListUnusedTOTPBackupCodes: %v", err)
	}
	if len(codes) != 3 {
		t.Fatalf("expected 3 unused codes, got %d", len(codes))
	}
	_ = tx2.Rollback()

	// --- Create replaces previous codes ---
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx3.CreateTOTPBackupCodes(ctx, userID, []string{"hash4", "hash5"}); err != nil {
		t.Fatalf("CreateTOTPBackupCodes (replace): %v", err)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit (replace): %v", err)
	}

	tx3b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterReplace, err := tx3b.ListUnusedTOTPBackupCodes(ctx, userID)
	if err != nil {
		t.Fatalf("ListUnusedTOTPBackupCodes after replace: %v", err)
	}
	if len(afterReplace) != 2 {
		t.Fatalf("expected 2 unused codes after replace, got %d", len(afterReplace))
	}
	firstCodeID := afterReplace[0].ID
	_ = tx3b.Rollback()

	// --- MarkUsed ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.MarkTOTPBackupCodeUsed(ctx, firstCodeID); err != nil {
		t.Fatalf("MarkTOTPBackupCodeUsed: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit (mark used): %v", err)
	}

	// ListUnused should now return only 1.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterMark, err := tx5.ListUnusedTOTPBackupCodes(ctx, userID)
	if err != nil {
		t.Fatalf("ListUnusedTOTPBackupCodes after mark: %v", err)
	}
	if len(afterMark) != 1 {
		t.Fatalf("expected 1 unused code after marking one used, got %d", len(afterMark))
	}
	if afterMark[0].ID == firstCodeID {
		t.Fatal("expected marked code to be excluded from unused list")
	}
	_ = tx5.Rollback()

	// --- DeleteTOTPBackupCodes ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteTOTPBackupCodes(ctx, userID); err != nil {
		t.Fatalf("DeleteTOTPBackupCodes: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit (delete): %v", err)
	}

	// Verify all codes gone.
	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	final, err := tx7.ListUnusedTOTPBackupCodes(ctx, userID)
	if err != nil {
		t.Fatalf("ListUnusedTOTPBackupCodes after delete: %v", err)
	}
	if len(final) != 0 {
		t.Fatalf("expected 0 codes after delete, got %d", len(final))
	}
	_ = tx7.Rollback()
}
