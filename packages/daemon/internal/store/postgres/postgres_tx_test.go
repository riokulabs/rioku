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

// createTestUser creates a user with the given username for FK satisfaction
// in tests that need to reference users(id). Returns the persisted user.
func createTestUser(t *testing.T, d store.Driver, ctx context.Context, username string) *store.User {
	t.Helper()
	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	user, err := tx.CreateUser(ctx, &store.User{
		Username:     username,
		PasswordHash: "$2a$10$dummy.hash.for.testing.purposes.only.x",
		Status:       "active",
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("CreateUser %q: %v", username, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	return user
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

	// FK setup: api_keys.owner_id references users(id)
	ownerUser := createTestUser(t, d, ctx, "api-key-owner-user")
	ownerID := ownerUser.ID

	expiry := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Millisecond)

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	id, err := tx1.CreateAPIKey(ctx, "test-key", "hash-abc123", []string{"read", "write"}, &expiry, ownerID)
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
	if key.OwnerID != ownerID {
		t.Fatalf("expected owner %q, got %q", ownerID, key.OwnerID)
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
	ownerKeys, err := tx4b.ListAPIKeysByOwner(ctx, ownerID)
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

	// FK setup: sessions.user_id references users(id)
	sessionUser := createTestUser(t, d, ctx, "session-test-user")
	testUserID := sessionUser.ID

	now := time.Now().UTC().Truncate(time.Millisecond)

	// --- Create ---
	ip := "127.0.0.1"
	ua := "test-agent/1.0"
	sess := &store.Session{
		ID:          "sess-test-001",
		UserID:      testUserID,
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
	if created.UserID != testUserID {
		t.Fatalf("expected user_id=%q, got %q", testUserID, created.UserID)
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
		UserID:      testUserID,
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
	sessions, err := tx3.ListSessionsByUser(ctx, testUserID)
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
	if err := tx5.DeleteSessionsByUserExcept(ctx, testUserID, "sess-test-001"); err != nil {
		t.Fatalf("DeleteSessionsByUserExcept: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx5b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sessions, err = tx5b.ListSessionsByUser(ctx, testUserID)
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
	sess3 := &store.Session{ID: "sess-test-003", UserID: testUserID, Fingerprint: "fp-3", CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastActive: now}
	sess4 := &store.Session{ID: "sess-test-004", UserID: testUserID, Fingerprint: "fp-4", CreatedAt: now, ExpiresAt: now.Add(-2 * time.Hour), LastActive: now.Add(-25 * time.Hour)} // already expired
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
	if err := txD.DeleteSessionsByUser(ctx, testUserID); err != nil {
		t.Fatalf("DeleteSessionsByUser: %v", err)
	}
	if err := txD.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txFinal, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sessions, err = txFinal.ListSessionsByUser(ctx, testUserID)
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

	// FK setup: user_roles.user_id and user_roles.granted_by reference users(id)
	roleUser := createTestUser(t, d, ctx, "user-roles-test-user-001")
	grantorUser := createTestUser(t, d, ctx, "admin-user-001")
	userID := roleUser.ID
	grantor := grantorUser.ID

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

	// FK setup: user_roles.user_id references users(id)
	scopesUser := createTestUser(t, d, ctx, "user-scopes-test-001")
	userID := scopesUser.ID

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

	// FK setup: totp_backup_codes.user_id references users(id)
	totpUser := createTestUser(t, d, ctx, "user-totp-test-001")
	userID := totpUser.ID

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

// ---------------------------------------------------------------------------
// Tenant CRUD (phase 2c4)
// ---------------------------------------------------------------------------

func TestTenant_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateTenant(ctx, &store.Tenant{
		Slug: "acme",
		Name: "Acme Corp",
		Plan: "pro",
	})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Slug != "acme" {
		t.Fatalf("expected slug 'acme', got %q", created.Slug)
	}
	if created.Plan != "pro" {
		t.Fatalf("expected plan 'pro', got %q", created.Plan)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tenantID := created.ID

	// --- GetTenant ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if got.Name != "Acme Corp" {
		t.Fatalf("expected name 'Acme Corp', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- GetTenantBySlug ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	bySlug, err := tx3.GetTenantBySlug(ctx, "acme")
	if err != nil {
		t.Fatalf("GetTenantBySlug: %v", err)
	}
	if bySlug.ID != tenantID {
		t.Fatalf("expected ID %q, got %q", tenantID, bySlug.ID)
	}
	_ = tx3.Rollback()

	// --- ListTenants (includes seed tenant_default) ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx4.ListTenants(ctx)
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	found := false
	for _, tn := range list {
		if tn.ID == tenantID {
			found = true
		}
	}
	if !found {
		t.Fatal("ListTenants: created tenant not in list")
	}
	_ = tx4.Rollback()

	// --- UpdateTenant ---
	newName := "Acme Updated"
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	updated, err := tx5.UpdateTenant(ctx, tenantID, store.UpdateTenantParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateTenant: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, updated.Name)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrTenantSlugTaken on duplicate slug ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, dupErr := tx6.CreateTenant(ctx, &store.Tenant{Slug: "acme", Name: "Dup"})
	_ = tx6.Rollback()
	if !errors.Is(dupErr, store.ErrTenantSlugTaken) {
		t.Fatalf("expected ErrTenantSlugTaken, got %v", dupErr)
	}

	// --- ErrTenantImmutable on deleting tenant_default ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	immErr := tx7.DeleteTenant(ctx, "tenant_default")
	_ = tx7.Rollback()
	if !errors.Is(immErr, store.ErrTenantImmutable) {
		t.Fatalf("expected ErrTenantImmutable, got %v", immErr)
	}

	// --- DeleteTenant ---
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx8.DeleteTenant(ctx, tenantID); err != nil {
		t.Fatalf("DeleteTenant: %v", err)
	}
	if err := tx8.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// GetTenant after delete must return ErrTenantNotFound.
	tx9, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := tx9.GetTenant(ctx, tenantID)
	_ = tx9.Rollback()
	if !errors.Is(nfErr, store.ErrTenantNotFound) {
		t.Fatalf("expected ErrTenantNotFound after delete, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Membership CRUD (phase 2c4)
// ---------------------------------------------------------------------------

func TestMembership_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Create a tenant and a user to attach the membership to.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "mb-tenant", Name: "Membership Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	email := "mbuser@example.com"
	user, err := txSetup.CreateUser(ctx, &store.User{
		Username: "mbuser", Email: &email, PasswordHash: "x", Status: "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}

	tenantID := tenant.ID
	userID := user.ID

	// --- Create pending membership ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateMembership(ctx, &store.Membership{
		TenantID: tenantID,
		UserID:   userID,
		State:    "pending",
	})
	if err != nil {
		t.Fatalf("CreateMembership: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.State != "pending" {
		t.Fatalf("expected state 'pending', got %q", created.State)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	mID := created.ID

	// --- GetMembership ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetMembership(ctx, mID)
	if err != nil {
		t.Fatalf("GetMembership: %v", err)
	}
	if got.TenantID != tenantID {
		t.Fatalf("expected TenantID %q, got %q", tenantID, got.TenantID)
	}
	_ = tx2.Rollback()

	// --- GetMembershipByTenantUser ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byPair, err := tx3.GetMembershipByTenantUser(ctx, tenantID, userID)
	if err != nil {
		t.Fatalf("GetMembershipByTenantUser: %v", err)
	}
	if byPair.ID != mID {
		t.Fatalf("expected ID %q, got %q", mID, byPair.ID)
	}
	_ = tx3.Rollback()

	// --- ListMembershipsByTenant ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byTenant, err := tx4.ListMembershipsByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListMembershipsByTenant: %v", err)
	}
	if len(byTenant) != 1 || byTenant[0].ID != mID {
		t.Fatalf("expected 1 membership with ID %q, got %d results", mID, len(byTenant))
	}
	_ = tx4.Rollback()

	// --- ListMembershipsByUser ---
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byUser, err := tx5.ListMembershipsByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ListMembershipsByUser: %v", err)
	}
	if len(byUser) != 1 || byUser[0].ID != mID {
		t.Fatalf("expected 1 membership by user, got %d", len(byUser))
	}
	_ = tx5.Rollback()

	// --- UpdateMembershipState: pending -> active ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	activated, err := tx6.UpdateMembershipState(ctx, mID, "active")
	if err != nil {
		t.Fatalf("UpdateMembershipState (active): %v", err)
	}
	if activated.State != "active" {
		t.Fatalf("expected state 'active', got %q", activated.State)
	}
	if activated.JoinedAt == nil {
		t.Fatal("expected JoinedAt set after activation")
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrMembershipInvalidState: removed -> active is forbidden ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	// First move to removed (active -> removed is valid).
	if _, err := tx7.UpdateMembershipState(ctx, mID, "removed"); err != nil {
		t.Fatalf("UpdateMembershipState (removed): %v", err)
	}
	// Now try invalid transition removed -> active.
	_, invErr := tx7.UpdateMembershipState(ctx, mID, "active")
	_ = tx7.Rollback()
	if !errors.Is(invErr, store.ErrMembershipInvalidState) {
		t.Fatalf("expected ErrMembershipInvalidState, got %v", invErr)
	}

	// --- ErrMembershipExists on duplicate (tenant_id, user_id) ---
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, dupErr := tx8.CreateMembership(ctx, &store.Membership{
		TenantID: tenantID,
		UserID:   userID,
	})
	_ = tx8.Rollback()
	if !errors.Is(dupErr, store.ErrMembershipExists) {
		t.Fatalf("expected ErrMembershipExists, got %v", dupErr)
	}

	// --- DeleteMembership ---
	tx9, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx9.DeleteMembership(ctx, mID); err != nil {
		t.Fatalf("DeleteMembership: %v", err)
	}
	if err := tx9.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx10, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := tx10.GetMembership(ctx, mID)
	_ = tx10.Rollback()
	if !errors.Is(nfErr, store.ErrMembershipNotFound) {
		t.Fatalf("expected ErrMembershipNotFound after delete, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// MembershipRoles (phase 2c4)
// ---------------------------------------------------------------------------

func TestMembershipRoles(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Setup: tenant + user + membership.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "mr-tenant", Name: "MR Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	email := "mruser@example.com"
	user, err := txSetup.CreateUser(ctx, &store.User{
		Username: "mruser", Email: &email, PasswordHash: "x", Status: "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	m, err := txSetup.CreateMembership(ctx, &store.Membership{
		TenantID: tenant.ID,
		UserID:   user.ID,
		State:    "active",
	})
	if err != nil {
		t.Fatalf("CreateMembership: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	mID := m.ID

	// Find the built-in viewer role to attach.
	txR, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	roles, err := txR.ListRoles(ctx)
	if err != nil {
		t.Fatalf("ListRoles: %v", err)
	}
	_ = txR.Rollback()
	if len(roles) == 0 {
		t.Skip("no roles seeded — skipping MembershipRoles test")
	}
	roleID := roles[0].ID

	// --- AssignMembershipRole ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx1.AssignMembershipRole(ctx, mID, roleID, ""); err != nil {
		t.Fatalf("AssignMembershipRole: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ListMembershipRoles ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	assigned, err := tx2.ListMembershipRoles(ctx, mID)
	if err != nil {
		t.Fatalf("ListMembershipRoles: %v", err)
	}
	if len(assigned) != 1 || assigned[0].ID != roleID {
		t.Fatalf("expected 1 role %q, got %d results", roleID, len(assigned))
	}
	_ = tx2.Rollback()

	// --- Assign-twice is idempotent ---
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx3.AssignMembershipRole(ctx, mID, roleID, "admin"); err != nil {
		t.Fatalf("AssignMembershipRole (dup): %v", err)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit (dup): %v", err)
	}

	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterDup, err := tx4.ListMembershipRoles(ctx, mID)
	if err != nil {
		t.Fatalf("ListMembershipRoles after dup: %v", err)
	}
	if len(afterDup) != 1 {
		t.Fatalf("expected exactly 1 role after idempotent assign, got %d", len(afterDup))
	}
	_ = tx4.Rollback()

	// --- RevokeMembershipRole ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.RevokeMembershipRole(ctx, mID, roleID); err != nil {
		t.Fatalf("RevokeMembershipRole: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit revoke: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterRevoke, err := tx6.ListMembershipRoles(ctx, mID)
	if err != nil {
		t.Fatalf("ListMembershipRoles after revoke: %v", err)
	}
	if len(afterRevoke) != 0 {
		t.Fatalf("expected 0 roles after revoke, got %d", len(afterRevoke))
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// Site CRUD (phase 2c4)
// ---------------------------------------------------------------------------

func TestSite_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Setup: create a tenant to own the sites.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "site-tenant", Name: "Site Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- CreateSite ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	site, err := tx1.CreateSite(ctx, &store.Site{
		TenantID: tenantID,
		Name:     "Main Site",
		Domain:   "main.example.com",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateSite: %v", err)
	}
	if site.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if site.TLSMode != "auto" {
		t.Fatalf("expected default TLSMode 'auto', got %q", site.TLSMode)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	siteID := site.ID

	// --- GetSite ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetSite(ctx, tenantID, siteID)
	if err != nil {
		t.Fatalf("GetSite: %v", err)
	}
	if got.Domain != "main.example.com" {
		t.Fatalf("expected domain 'main.example.com', got %q", got.Domain)
	}
	_ = tx2.Rollback()

	// --- ListSitesByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListSitesByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListSitesByTenant: %v", err)
	}
	if len(list) != 1 || list[0].ID != siteID {
		t.Fatalf("expected 1 site %q, got %d results", siteID, len(list))
	}
	_ = tx3.Rollback()

	// --- UpdateSite ---
	newName := "Updated Site"
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	updated, err := tx4.UpdateSite(ctx, tenantID, siteID, store.UpdateSiteParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateSite: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, updated.Name)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ToggleSite (disable) ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	toggled, err := tx5.ToggleSite(ctx, tenantID, siteID, false)
	if err != nil {
		t.Fatalf("ToggleSite: %v", err)
	}
	if toggled.Enabled {
		t.Fatal("expected enabled=false after toggle")
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrSiteDomainTaken on duplicate domain ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, dupErr := tx6.CreateSite(ctx, &store.Site{
		TenantID: tenantID,
		Name:     "Dup",
		Domain:   "main.example.com",
	})
	_ = tx6.Rollback()
	if !errors.Is(dupErr, store.ErrSiteDomainTaken) {
		t.Fatalf("expected ErrSiteDomainTaken, got %v", dupErr)
	}

	// --- DeleteSite ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DeleteSite(ctx, tenantID, siteID); err != nil {
		t.Fatalf("DeleteSite: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx8, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := tx8.GetSite(ctx, tenantID, siteID)
	_ = tx8.Rollback()
	if !errors.Is(nfErr, store.ErrSiteNotFound) {
		t.Fatalf("expected ErrSiteNotFound after delete, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Middleware CRUD (phase 2c4)
// ---------------------------------------------------------------------------

func TestMiddleware_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Setup: create a tenant.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "mw-tenant", Name: "MW Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- CreateMiddleware ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	mw, err := tx1.CreateMiddleware(ctx, &store.Middleware{
		TenantID:  tenantID,
		Name:      "rate-limiter",
		Kind:      "rate-limit",
		Enabled:   true,
		OrderHint: 10,
	})
	if err != nil {
		t.Fatalf("CreateMiddleware: %v", err)
	}
	if mw.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if mw.Config != "{}" {
		t.Fatalf("expected default config '{}', got %q", mw.Config)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	mwID := mw.ID

	// --- GetMiddleware ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetMiddleware(ctx, tenantID, mwID)
	if err != nil {
		t.Fatalf("GetMiddleware: %v", err)
	}
	if got.Kind != "rate-limit" {
		t.Fatalf("expected kind 'rate-limit', got %q", got.Kind)
	}
	_ = tx2.Rollback()

	// --- ListMiddlewaresByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListMiddlewaresByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListMiddlewaresByTenant: %v", err)
	}
	if len(list) != 1 || list[0].ID != mwID {
		t.Fatalf("expected 1 middleware %q, got %d results", mwID, len(list))
	}
	_ = tx3.Rollback()

	// --- UpdateMiddleware ---
	newName := "rate-limiter-v2"
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	updated, err := tx4.UpdateMiddleware(ctx, tenantID, mwID, store.UpdateMiddlewareParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateMiddleware: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, updated.Name)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrMiddlewareNameTaken on duplicate (tenant_id, name) ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, dupErr := tx5.CreateMiddleware(ctx, &store.Middleware{
		TenantID: tenantID,
		Name:     "rate-limiter-v2", // same name as updated mw
		Kind:     "rate-limit",
	})
	_ = tx5.Rollback()
	if !errors.Is(dupErr, store.ErrMiddlewareNameTaken) {
		t.Fatalf("expected ErrMiddlewareNameTaken, got %v", dupErr)
	}

	// --- DeleteMiddleware ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteMiddleware(ctx, tenantID, mwID); err != nil {
		t.Fatalf("DeleteMiddleware: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := tx7.GetMiddleware(ctx, tenantID, mwID)
	_ = tx7.Rollback()
	if !errors.Is(nfErr, store.ErrMiddlewareNotFound) {
		t.Fatalf("expected ErrMiddlewareNotFound after delete, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Dashboard CRUD (phase 2c5)
// ---------------------------------------------------------------------------

func TestDashboard_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	tenantID := "tenant_default"

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateDashboard(ctx, &store.Dashboard{
		TenantID:    tenantID,
		Name:        "Test Dashboard",
		Description: "desc",
		Mode:        "metabase",
		Scope:       "tenant",
	})
	if err != nil {
		t.Fatalf("CreateDashboard: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Name != "Test Dashboard" {
		t.Fatalf("expected name 'Test Dashboard', got %q", created.Name)
	}
	if created.IsDefault {
		t.Fatal("expected is_default=false on creation")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	dashID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetDashboard(ctx, tenantID, dashID)
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	if got.Name != "Test Dashboard" {
		t.Fatalf("expected 'Test Dashboard', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- ListByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListDashboardsByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListDashboardsByTenant: %v", err)
	}
	found := false
	for _, item := range list {
		if item.ID == dashID {
			found = true
		}
	}
	if !found {
		t.Fatal("created dashboard not in list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newName := "Updated Dashboard"
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	updated, err := tx4.UpdateDashboard(ctx, tenantID, dashID, store.UpdateDashboardParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateDashboard: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, updated.Name)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- SetDefaultDashboard ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx5.SetDefaultDashboard(ctx, tenantID, dashID)
	if err != nil {
		t.Fatalf("SetDefaultDashboard: %v", err)
	}
	if !def.IsDefault {
		t.Fatal("expected is_default=true after SetDefaultDashboard")
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- SetDashboardHomeForUser (uniqueness invariant) ---
	// Create a second dashboard to verify the userID is removed from it when
	// the first dashboard becomes the home.
	txSetup2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	dash2, err := txSetup2.CreateDashboard(ctx, &store.Dashboard{
		TenantID: tenantID,
		Name:     "Second Dashboard",
	})
	if err != nil {
		t.Fatalf("CreateDashboard (second): %v", err)
	}
	if err := txSetup2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	dash2ID := dash2.ID

	// Set userID as home on dash2 first.
	testUserID := "user-home-test-001"
	txH1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := txH1.SetDashboardHomeForUser(ctx, tenantID, dash2ID, testUserID); err != nil {
		t.Fatalf("SetDashboardHomeForUser (dash2): %v", err)
	}
	if err := txH1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Now move the home to dashID — dash2 must no longer have the user.
	txH2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	homeResult, err := txH2.SetDashboardHomeForUser(ctx, tenantID, dashID, testUserID)
	if err != nil {
		t.Fatalf("SetDashboardHomeForUser (dashID): %v", err)
	}
	if err := txH2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	// homeResult is dashID; it should contain the user.
	if !strings.Contains(homeResult.HomeForUsers, testUserID) {
		t.Fatalf("expected testUserID in home_for_users of dashID, got %q", homeResult.HomeForUsers)
	}

	// Verify dash2 no longer has the user.
	txH3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	dash2After, err := txH3.GetDashboard(ctx, tenantID, dash2ID)
	if err != nil {
		t.Fatalf("GetDashboard (dash2 after): %v", err)
	}
	_ = txH3.Rollback()
	if strings.Contains(dash2After.HomeForUsers, testUserID) {
		t.Fatalf("expected testUserID removed from dash2, still present in %q", dash2After.HomeForUsers)
	}

	// --- ErrDashboardNotFound on missing ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetDashboard(ctx, tenantID, "dash_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrDashboardNotFound) {
		t.Fatalf("expected ErrDashboardNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteDashboard(ctx, tenantID, dashID); err != nil {
		t.Fatalf("DeleteDashboard: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetDashboard(ctx, tenantID, dashID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrDashboardNotFound) {
		t.Fatalf("expected ErrDashboardNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// Widget CRUD (phase 2c5)
// ---------------------------------------------------------------------------

func TestWidget_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	tenantID := "tenant_default"

	// Pre-create parent dashboard.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	dash, err := txSetup.CreateDashboard(ctx, &store.Dashboard{
		TenantID: tenantID,
		Name:     "Widget Test Dashboard",
	})
	if err != nil {
		t.Fatalf("CreateDashboard: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	dashID := dash.ID

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateWidget(ctx, &store.Widget{
		DashboardID: dashID,
		Kind:        "stat",
		Title:       "Test Widget",
		DataSource:  "prometheus",
	})
	if err != nil {
		t.Fatalf("CreateWidget: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Kind != "stat" {
		t.Fatalf("expected kind 'stat', got %q", created.Kind)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	widgetID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetWidget(ctx, widgetID)
	if err != nil {
		t.Fatalf("GetWidget: %v", err)
	}
	if got.Title != "Test Widget" {
		t.Fatalf("expected 'Test Widget', got %q", got.Title)
	}
	_ = tx2.Rollback()

	// --- ListByDashboard ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListWidgetsByDashboard(ctx, dashID)
	if err != nil {
		t.Fatalf("ListWidgetsByDashboard: %v", err)
	}
	if len(list) != 1 || list[0].ID != widgetID {
		t.Fatalf("expected 1 widget %q, got %d results", widgetID, len(list))
	}
	_ = tx3.Rollback()

	// --- Update ---
	newTitle := "Updated Widget"
	lockedAdv := true
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateWidget(ctx, widgetID, store.UpdateWidgetParams{
		Title:          &newTitle,
		LockedAdvanced: &lockedAdv,
	})
	if err != nil {
		t.Fatalf("UpdateWidget: %v", err)
	}
	if upd.Title != newTitle {
		t.Fatalf("expected title %q, got %q", newTitle, upd.Title)
	}
	if !upd.LockedAdvanced {
		t.Fatal("expected locked_advanced=true")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- UpdateDashboardLayout ---
	txL, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newLayout := `{"x":1,"y":2,"w":6,"h":4}`
	if err := txL.UpdateDashboardLayout(ctx, dashID, map[string]string{widgetID: newLayout}); err != nil {
		t.Fatalf("UpdateDashboardLayout: %v", err)
	}
	if err := txL.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	txLR, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	wAfter, err := txLR.GetWidget(ctx, widgetID)
	if err != nil {
		t.Fatalf("GetWidget after layout update: %v", err)
	}
	_ = txLR.Rollback()
	if wAfter.Layout != newLayout {
		t.Fatalf("expected layout %q, got %q", newLayout, wAfter.Layout)
	}

	// --- ErrWidgetNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetWidget(ctx, "widget_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrWidgetNotFound) {
		t.Fatalf("expected ErrWidgetNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteWidget(ctx, dashID, widgetID); err != nil {
		t.Fatalf("DeleteWidget: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetWidget(ctx, widgetID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrWidgetNotFound) {
		t.Fatalf("expected ErrWidgetNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// DashboardVersion (phase 2c5)
// ---------------------------------------------------------------------------

func TestDashboardVersion(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	tenantID := "tenant_default"

	// Pre-create parent dashboard.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	dash, err := txSetup.CreateDashboard(ctx, &store.Dashboard{
		TenantID: tenantID,
		Name:     "Version Test Dashboard",
	})
	if err != nil {
		t.Fatalf("CreateDashboard: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	dashID := dash.ID

	// --- Create v1 ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	v1, err := tx1.CreateDashboardVersion(ctx, &store.DashboardVersion{
		DashboardID:  dashID,
		Note:         "initial version",
		SnapshotJSON: `{"widgets":[]}`,
	})
	if err != nil {
		t.Fatalf("CreateDashboardVersion v1: %v", err)
	}
	if v1.Version != 1 {
		t.Fatalf("expected version=1, got %d", v1.Version)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create v2 ---
	tx1b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	v2, err := tx1b.CreateDashboardVersion(ctx, &store.DashboardVersion{
		DashboardID:  dashID,
		Note:         "second version",
		SnapshotJSON: `{"widgets":[{"id":"w1"}]}`,
	})
	if err != nil {
		t.Fatalf("CreateDashboardVersion v2: %v", err)
	}
	if v2.Version != 2 {
		t.Fatalf("expected version=2, got %d", v2.Version)
	}
	if err := tx1b.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetDashboardVersion(ctx, v1.ID)
	if err != nil {
		t.Fatalf("GetDashboardVersion: %v", err)
	}
	if got.Note != "initial version" {
		t.Fatalf("expected note 'initial version', got %q", got.Note)
	}
	_ = tx2.Rollback()

	// --- List (ordered DESC) ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	versions, err := tx3.ListDashboardVersions(ctx, dashID)
	if err != nil {
		t.Fatalf("ListDashboardVersions: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("expected 2 versions, got %d", len(versions))
	}
	// First result should be highest version (DESC order).
	if versions[0].Version != 2 {
		t.Fatalf("expected first version=2 (DESC), got %d", versions[0].Version)
	}
	_ = tx3.Rollback()

	// --- ErrVersionNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetDashboardVersion(ctx, "ver_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrVersionNotFound) {
		t.Fatalf("expected ErrVersionNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// DashboardShare CRUD (phase 2c5)
// ---------------------------------------------------------------------------

func TestDashboardShare_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	tenantID := "tenant_default"
	tCtx := store.WithTenantID(ctx, tenantID)

	// Pre-create parent dashboard.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	dash, err := txSetup.CreateDashboard(ctx, &store.Dashboard{
		TenantID: tenantID,
		Name:     "Share Test Dashboard",
	})
	if err != nil {
		t.Fatalf("CreateDashboard: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	dashID := dash.ID

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	createdBy := "user-share-test-001"
	share, err := tx1.CreateDashboardShare(tCtx, &store.DashboardShare{
		DashboardID: dashID,
		RoleID:      "role_viewer",
		CreatedBy:   &createdBy,
	})
	if err != nil {
		t.Fatalf("CreateDashboardShare: %v", err)
	}
	if share.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if share.RoleID != "role_viewer" {
		t.Fatalf("expected role 'role_viewer', got %q", share.RoleID)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	shareID := share.ID

	// --- List ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	shares, err := tx2.ListDashboardShares(tCtx, dashID)
	if err != nil {
		t.Fatalf("ListDashboardShares: %v", err)
	}
	if len(shares) != 1 || shares[0].ID != shareID {
		t.Fatalf("expected 1 share %q, got %d results", shareID, len(shares))
	}
	_ = tx2.Rollback()

	// --- Delete ---
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx3.DeleteDashboardShare(tCtx, shareID); err != nil {
		t.Fatalf("DeleteDashboardShare: %v", err)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterDel, err := tx4.ListDashboardShares(tCtx, dashID)
	if err != nil {
		t.Fatalf("ListDashboardShares after delete: %v", err)
	}
	_ = tx4.Rollback()
	if len(afterDel) != 0 {
		t.Fatalf("expected 0 shares after delete, got %d", len(afterDel))
	}
}

// ---------------------------------------------------------------------------
// AccessPolicy CRUD (phase 2c5)
// ---------------------------------------------------------------------------

func TestAccessPolicy_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	tenantID := "tenant_default"
	tCtx := store.WithTenantID(ctx, tenantID)

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateAccessPolicy(tCtx, &store.AccessPolicy{
		Name:        "block-guests",
		Description: "Blocks guest users",
		Effect:      store.AccessPolicyDeny,
		TargetType:  store.AccessPolicyTargetRoles,
		TargetIDs:   []string{"role-guest"},
		Priority:    10,
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("CreateAccessPolicy: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Effect != store.AccessPolicyDeny {
		t.Fatalf("expected effect 'deny', got %q", created.Effect)
	}
	if len(created.TargetIDs) != 1 || created.TargetIDs[0] != "role-guest" {
		t.Fatalf("expected target_ids=[role-guest], got %v", created.TargetIDs)
	}
	if !created.Enabled {
		t.Fatal("expected enabled=true")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	policyID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAccessPolicy(tCtx, policyID)
	if err != nil {
		t.Fatalf("GetAccessPolicy: %v", err)
	}
	if got.Name != "block-guests" {
		t.Fatalf("expected name 'block-guests', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListAccessPolicies(tCtx)
	if err != nil {
		t.Fatalf("ListAccessPolicies: %v", err)
	}
	found := false
	for _, p := range list {
		if p.ID == policyID {
			found = true
		}
	}
	if !found {
		t.Fatal("created policy not in list")
	}
	_ = tx3.Rollback()

	// --- Update (each field) ---
	newName := "block-guests-v2"
	newDesc := "Updated description"
	newEffect := store.AccessPolicyAllow
	newTargetType := store.AccessPolicyTargetUsers
	newTargetIDs := []string{"user-001", "user-002"}
	newConditions := []store.AccessPolicyCondition{{Type: "ip", Config: map[string]any{"range": "10.0.0.0/8"}}}
	newPriority := 5
	newEnabled := false

	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateAccessPolicy(tCtx, policyID, store.UpdateAccessPolicyParams{
		Name:        &newName,
		Description: &newDesc,
		Effect:      &newEffect,
		TargetType:  &newTargetType,
		TargetIDs:   &newTargetIDs,
		Conditions:  &newConditions,
		Priority:    &newPriority,
		Enabled:     &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateAccessPolicy: %v", err)
	}
	if upd.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, upd.Name)
	}
	if upd.Effect != store.AccessPolicyAllow {
		t.Fatalf("expected effect 'allow', got %q", upd.Effect)
	}
	if len(upd.TargetIDs) != 2 {
		t.Fatalf("expected 2 target_ids, got %d", len(upd.TargetIDs))
	}
	if len(upd.Conditions) != 1 || upd.Conditions[0].Type != "ip" {
		t.Fatalf("expected 1 condition with type 'ip', got %v", upd.Conditions)
	}
	if upd.Priority != 5 {
		t.Fatalf("expected priority 5, got %d", upd.Priority)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrAccessPolicyDuplicate on duplicate name ---
	txDup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, dupErr := txDup.CreateAccessPolicy(tCtx, &store.AccessPolicy{
		Name:       "block-guests-v2", // same name as updated policy
		Effect:     store.AccessPolicyDeny,
		TargetType: store.AccessPolicyTargetAll,
		Enabled:    true,
	})
	_ = txDup.Rollback()
	if !errors.Is(dupErr, store.ErrAccessPolicyDuplicate) {
		t.Fatalf("expected ErrAccessPolicyDuplicate, got %v", dupErr)
	}

	// --- ErrAccessPolicyNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetAccessPolicy(tCtx, "ap_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrAccessPolicyNotFound) {
		t.Fatalf("expected ErrAccessPolicyNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAccessPolicy(tCtx, policyID); err != nil {
		t.Fatalf("DeleteAccessPolicy: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetAccessPolicy(tCtx, policyID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrAccessPolicyNotFound) {
		t.Fatalf("expected ErrAccessPolicyNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// RbacPolicy CRUD (phase 2c5)
// ---------------------------------------------------------------------------

func TestRbacPolicy_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	tenantID := "tenant_default"
	tCtx := store.WithTenantID(ctx, tenantID)

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateRbacPolicy(tCtx, &store.RbacPolicy{
		Name:        "assign-admin",
		Description: "Grants admin to user-001",
		SubjectType: "user",
		SubjectID:   "user-001",
		RoleID:      "role_admin",
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("CreateRbacPolicy: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.SubjectType != "user" {
		t.Fatalf("expected subject_type 'user', got %q", created.SubjectType)
	}
	if !created.Enabled {
		t.Fatal("expected enabled=true")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	policyID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetRbacPolicy(tCtx, policyID)
	if err != nil {
		t.Fatalf("GetRbacPolicy: %v", err)
	}
	if got.RoleID != "role_admin" {
		t.Fatalf("expected role_id 'role_admin', got %q", got.RoleID)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListRbacPolicies(tCtx)
	if err != nil {
		t.Fatalf("ListRbacPolicies: %v", err)
	}
	found := false
	for _, p := range list {
		if p.ID == policyID {
			found = true
		}
	}
	if !found {
		t.Fatal("created rbac policy not in list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newName := "assign-admin-v2"
	newSubjectID := "user-002"
	newEnabled := false
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateRbacPolicy(tCtx, policyID, store.UpdateRbacPolicyParams{
		Name:      &newName,
		SubjectID: &newSubjectID,
		Enabled:   &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateRbacPolicy: %v", err)
	}
	if upd.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, upd.Name)
	}
	if upd.SubjectID != newSubjectID {
		t.Fatalf("expected subject_id %q, got %q", newSubjectID, upd.SubjectID)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrRbacPolicyNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetRbacPolicy(tCtx, "rp_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrRbacPolicyNotFound) {
		t.Fatalf("expected ErrRbacPolicyNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteRbacPolicy(tCtx, policyID); err != nil {
		t.Fatalf("DeleteRbacPolicy: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetRbacPolicy(tCtx, policyID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrRbacPolicyNotFound) {
		t.Fatalf("expected ErrRbacPolicyNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// AI — Providers
// ---------------------------------------------------------------------------

func TestAIProvider_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Pre-create a tenant.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "aiprov-tenant", Name: "AI Provider Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateAIProvider(ctx, &store.AIProvider{
		TenantID: tenantID,
		Name:     "openai-main",
		Kind:     "openai",
		BaseURL:  "https://api.openai.com",
		Enabled:  true,
		Metadata: `{"org":"test"}`,
	})
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Kind != "openai" {
		t.Fatalf("expected kind 'openai', got %q", created.Kind)
	}
	if !created.Enabled {
		t.Fatal("expected enabled=true")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	providerID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAIProvider(ctx, tenantID, providerID)
	if err != nil {
		t.Fatalf("GetAIProvider: %v", err)
	}
	if got.Name != "openai-main" {
		t.Fatalf("expected name 'openai-main', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListAIProvidersByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListAIProvidersByTenant: %v", err)
	}
	found := false
	for _, p := range list {
		if p.ID == providerID {
			found = true
		}
	}
	if !found {
		t.Fatal("created provider not in list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newName := "openai-v2"
	newEnabled := false
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateAIProvider(ctx, tenantID, providerID, store.UpdateAIProviderParams{
		Name:    &newName,
		Enabled: &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateAIProvider: %v", err)
	}
	if upd.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, upd.Name)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrAIProviderNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetAIProvider(ctx, tenantID, "aiprov_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrAIProviderNotFound) {
		t.Fatalf("expected ErrAIProviderNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAIProvider(ctx, tenantID, providerID); err != nil {
		t.Fatalf("DeleteAIProvider: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetAIProvider(ctx, tenantID, providerID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrAIProviderNotFound) {
		t.Fatalf("expected ErrAIProviderNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// AI — Provider Models
// ---------------------------------------------------------------------------

func TestProviderModel_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Pre-create tenant + provider.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "aimodel-tenant", Name: "AI Model Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	provider, err := txSetup.CreateAIProvider(ctx, &store.AIProvider{
		TenantID: tenant.ID, Name: "openai-for-models", Kind: "openai", Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	providerID := provider.ID

	// --- Add ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.AddProviderModel(ctx, &store.AIProviderModel{
		ProviderID:      providerID,
		UpstreamModelID: "gpt-4-turbo",
		Alias:           "gpt4",
		RateLimitRPM:    60,
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("AddProviderModel: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Alias != "gpt4" {
		t.Fatalf("expected alias 'gpt4', got %q", created.Alias)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	modelID := created.ID

	// --- List ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx2.ListProviderModels(ctx, providerID)
	if err != nil {
		t.Fatalf("ListProviderModels: %v", err)
	}
	found := false
	for _, m := range list {
		if m.ID == modelID {
			found = true
		}
	}
	if !found {
		t.Fatal("created model not in list")
	}
	_ = tx2.Rollback()

	// --- Update ---
	newAlias := "gpt4-v2"
	newEnabled := false
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx3.UpdateProviderModel(ctx, providerID, modelID, store.UpdateAIProviderModelParams{
		Alias:   &newAlias,
		Enabled: &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateProviderModel: %v", err)
	}
	if upd.Alias != newAlias {
		t.Fatalf("expected alias %q, got %q", newAlias, upd.Alias)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Remove ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.RemoveProviderModel(ctx, providerID, modelID); err != nil {
		t.Fatalf("RemoveProviderModel: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrAIProviderModelNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.UpdateProviderModel(ctx, providerID, modelID, store.UpdateAIProviderModelParams{})
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrAIProviderModelNotFound) {
		t.Fatalf("expected ErrAIProviderModelNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// AI — MCP Servers
// ---------------------------------------------------------------------------

func TestMCPServer_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "mcp-tenant", Name: "MCP Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateMCPServer(ctx, &store.AIMCPServer{
		TenantID: tenantID,
		Name:     "my-mcp",
		URL:      "https://mcp.example.com",
		AuthKind: "none",
		Health:   "disabled",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.URL != "https://mcp.example.com" {
		t.Fatalf("expected URL 'https://mcp.example.com', got %q", created.URL)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	serverID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetMCPServer(ctx, tenantID, serverID)
	if err != nil {
		t.Fatalf("GetMCPServer: %v", err)
	}
	if got.Name != "my-mcp" {
		t.Fatalf("expected name 'my-mcp', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListMCPServersByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListMCPServersByTenant: %v", err)
	}
	found := false
	for _, s := range list {
		if s.ID == serverID {
			found = true
		}
	}
	if !found {
		t.Fatal("created mcp server not in list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newHealth := "healthy"
	newEnabled := false
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateMCPServer(ctx, tenantID, serverID, store.UpdateAIMCPServerParams{
		Health:  &newHealth,
		Enabled: &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateMCPServer: %v", err)
	}
	if upd.Health != newHealth {
		t.Fatalf("expected health %q, got %q", newHealth, upd.Health)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrMCPServerNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetMCPServer(ctx, tenantID, "mcp_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrMCPServerNotFound) {
		t.Fatalf("expected ErrMCPServerNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteMCPServer(ctx, tenantID, serverID); err != nil {
		t.Fatalf("DeleteMCPServer: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetMCPServer(ctx, tenantID, serverID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrMCPServerNotFound) {
		t.Fatalf("expected ErrMCPServerNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// AI — Tools
// ---------------------------------------------------------------------------

func TestAITool_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "aitool-tenant", Name: "AI Tool Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateAITool(ctx, &store.AITool{
		TenantID:    tenantID,
		Name:        "web-search",
		Kind:        "native",
		Description: "Searches the web",
		SchemaJSON:  `{"type":"object"}`,
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("CreateAITool: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Kind != "native" {
		t.Fatalf("expected kind 'native', got %q", created.Kind)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	toolID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAITool(ctx, tenantID, toolID)
	if err != nil {
		t.Fatalf("GetAITool: %v", err)
	}
	if got.Name != "web-search" {
		t.Fatalf("expected name 'web-search', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListAIToolsByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListAIToolsByTenant: %v", err)
	}
	found := false
	for _, x := range list {
		if x.ID == toolID {
			found = true
		}
	}
	if !found {
		t.Fatal("created ai tool not in list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newDesc := "Searches the web v2"
	newDangerous := true
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateAITool(ctx, tenantID, toolID, store.UpdateAIToolParams{
		Description: &newDesc,
		Dangerous:   &newDangerous,
	})
	if err != nil {
		t.Fatalf("UpdateAITool: %v", err)
	}
	if upd.Description != newDesc {
		t.Fatalf("expected description %q, got %q", newDesc, upd.Description)
	}
	if !upd.Dangerous {
		t.Fatal("expected dangerous=true after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrAIToolNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetAITool(ctx, tenantID, "aitool_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrAIToolNotFound) {
		t.Fatalf("expected ErrAIToolNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAITool(ctx, tenantID, toolID); err != nil {
		t.Fatalf("DeleteAITool: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetAITool(ctx, tenantID, toolID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrAIToolNotFound) {
		t.Fatalf("expected ErrAIToolNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// AI — Agents
// ---------------------------------------------------------------------------

func TestAIAgent_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "aiagent-tenant", Name: "AI Agent Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateAIAgent(ctx, &store.AIAgent{
		TenantID:    tenantID,
		Name:        "support-agent",
		Description: "Customer support agent",
		Model:       "gpt-4",
		Enabled:     true,
		Guardrails:  `{"max_tokens":4096}`,
	})
	if err != nil {
		t.Fatalf("CreateAIAgent: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Model != "gpt-4" {
		t.Fatalf("expected model 'gpt-4', got %q", created.Model)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	agentID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAIAgent(ctx, tenantID, agentID)
	if err != nil {
		t.Fatalf("GetAIAgent: %v", err)
	}
	if got.Name != "support-agent" {
		t.Fatalf("expected name 'support-agent', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListAIAgentsByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListAIAgentsByTenant: %v", err)
	}
	found := false
	for _, a := range list {
		if a.ID == agentID {
			found = true
		}
	}
	if !found {
		t.Fatal("created agent not in list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newModel := "gpt-4o"
	newEnabled := false
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateAIAgent(ctx, tenantID, agentID, store.UpdateAIAgentParams{
		Model:   &newModel,
		Enabled: &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateAIAgent: %v", err)
	}
	if upd.Model != newModel {
		t.Fatalf("expected model %q, got %q", newModel, upd.Model)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrAIAgentNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetAIAgent(ctx, tenantID, "aiagent_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrAIAgentNotFound) {
		t.Fatalf("expected ErrAIAgentNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAIAgent(ctx, tenantID, agentID); err != nil {
		t.Fatalf("DeleteAIAgent: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetAIAgent(ctx, tenantID, agentID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrAIAgentNotFound) {
		t.Fatalf("expected ErrAIAgentNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// AI — Tool Bindings
// ---------------------------------------------------------------------------

func TestAIToolBinding_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Pre-create tenant, agent, and tool.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "aibind-tenant", Name: "AI Binding Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	agent, err := txSetup.CreateAIAgent(ctx, &store.AIAgent{
		TenantID: tenant.ID, Name: "bind-agent", Model: "gpt-4", Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateAIAgent: %v", err)
	}
	tool, err := txSetup.CreateAITool(ctx, &store.AITool{
		TenantID: tenant.ID, Name: "bind-tool", Kind: "native", Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateAITool: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID, agentID, toolID := tenant.ID, agent.ID, tool.ID

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateAIToolBinding(ctx, &store.AIToolBinding{
		TenantID:  tenantID,
		AgentID:   agentID,
		ToolID:    toolID,
		Condition: "",
		Enabled:   true,
	})
	if err != nil {
		t.Fatalf("CreateAIToolBinding: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.AgentID != agentID {
		t.Fatalf("expected agent_id %q, got %q", agentID, created.AgentID)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	bindingID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAIToolBinding(ctx, tenantID, bindingID)
	if err != nil {
		t.Fatalf("GetAIToolBinding: %v", err)
	}
	if got.ToolID != toolID {
		t.Fatalf("expected tool_id %q, got %q", toolID, got.ToolID)
	}
	_ = tx2.Rollback()

	// --- ListByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byTenant, err := tx3.ListAIToolBindingsByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListAIToolBindingsByTenant: %v", err)
	}
	found := false
	for _, b := range byTenant {
		if b.ID == bindingID {
			found = true
		}
	}
	if !found {
		t.Fatal("created binding not in tenant list")
	}
	_ = tx3.Rollback()

	// --- ListByAgent ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byAgent, err := tx4.ListAIToolBindingsByAgent(ctx, agentID)
	if err != nil {
		t.Fatalf("ListAIToolBindingsByAgent: %v", err)
	}
	if len(byAgent) == 0 || byAgent[0].ID != bindingID {
		t.Fatalf("expected binding %q in agent list, got %d results", bindingID, len(byAgent))
	}
	_ = tx4.Rollback()

	// --- Update ---
	newCond := "request.method == 'GET'"
	newEnabled := false
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx5.UpdateAIToolBinding(ctx, tenantID, bindingID, store.UpdateAIToolBindingParams{
		Condition: &newCond,
		Enabled:   &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateAIToolBinding: %v", err)
	}
	if upd.Condition != newCond {
		t.Fatalf("expected condition %q, got %q", newCond, upd.Condition)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrAIBindingNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetAIToolBinding(ctx, tenantID, "aibind_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrAIBindingNotFound) {
		t.Fatalf("expected ErrAIBindingNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteAIToolBinding(ctx, tenantID, bindingID); err != nil {
		t.Fatalf("DeleteAIToolBinding: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetAIToolBinding(ctx, tenantID, bindingID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrAIBindingNotFound) {
		t.Fatalf("expected ErrAIBindingNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// AI — Rate Limits
// ---------------------------------------------------------------------------

func TestAIRateLimit_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "airl-tenant", Name: "AI RL Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateAIRateLimit(ctx, &store.AISemanticRateLimit{
		TenantID:            tenantID,
		Name:                "jailbreak-rl",
		Scope:               "tenant",
		Exemplars:           `["ignore your instructions"]`,
		SimilarityThreshold: 0.85,
		WindowSeconds:       60,
		Threshold:           5,
		Action:              "block",
		Enabled:             true,
	})
	if err != nil {
		t.Fatalf("CreateAIRateLimit: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Scope != "tenant" {
		t.Fatalf("expected scope 'tenant', got %q", created.Scope)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	rlID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAIRateLimit(ctx, tenantID, rlID)
	if err != nil {
		t.Fatalf("GetAIRateLimit: %v", err)
	}
	if got.Action != "block" {
		t.Fatalf("expected action 'block', got %q", got.Action)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListAIRateLimitsByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListAIRateLimitsByTenant: %v", err)
	}
	found := false
	for _, r := range list {
		if r.ID == rlID {
			found = true
		}
	}
	if !found {
		t.Fatal("created rate limit not in list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newAction := "log"
	newThreshold := int32(10)
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateAIRateLimit(ctx, tenantID, rlID, store.UpdateAIRateLimitParams{
		Action:    &newAction,
		Threshold: &newThreshold,
	})
	if err != nil {
		t.Fatalf("UpdateAIRateLimit: %v", err)
	}
	if upd.Action != newAction {
		t.Fatalf("expected action %q, got %q", newAction, upd.Action)
	}
	if upd.Threshold != newThreshold {
		t.Fatalf("expected threshold %d, got %d", newThreshold, upd.Threshold)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrAIRateLimitNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetAIRateLimit(ctx, tenantID, "airl_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrAIRateLimitNotFound) {
		t.Fatalf("expected ErrAIRateLimitNotFound, got %v", nfErr)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAIRateLimit(ctx, tenantID, rlID); err != nil {
		t.Fatalf("DeleteAIRateLimit: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	txDel, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, delErr := txDel.GetAIRateLimit(ctx, tenantID, rlID)
	_ = txDel.Rollback()
	if !errors.Is(delErr, store.ErrAIRateLimitNotFound) {
		t.Fatalf("expected ErrAIRateLimitNotFound after delete, got %v", delErr)
	}
}

// ---------------------------------------------------------------------------
// AI — Traces
// ---------------------------------------------------------------------------

func TestAITrace(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Pre-create tenant and agent (optional agent FK for traces).
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "aitrace-tenant", Name: "AI Trace Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	agent, err := txSetup.CreateAIAgent(ctx, &store.AIAgent{
		TenantID: tenant.ID, Name: "trace-agent", Model: "gpt-4", Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateAIAgent: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID, agentID := tenant.ID, agent.ID

	now := time.Now().UTC()
	prompt := "Hello, world"
	completion := "Hi there!"

	// --- AppendAITrace ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	appended, err := tx1.AppendAITrace(ctx, &store.AITrace{
		TenantID:     tenantID,
		AgentID:      &agentID,
		Model:        "gpt-4",
		Status:       "success",
		InputTokens:  100,
		OutputTokens: 200,
		DurationMS:   500,
		Prompt:       &prompt,
		Completion:   &completion,
		OccurredAt:   now,
	})
	if err != nil {
		t.Fatalf("AppendAITrace: %v", err)
	}
	if appended.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if appended.Status != "success" {
		t.Fatalf("expected status 'success', got %q", appended.Status)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	traceID := appended.ID

	// --- GetAITrace ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAITrace(ctx, tenantID, traceID)
	if err != nil {
		t.Fatalf("GetAITrace: %v", err)
	}
	if got.InputTokens != 100 {
		t.Fatalf("expected input_tokens 100, got %d", got.InputTokens)
	}
	if got.AgentID == nil || *got.AgentID != agentID {
		t.Fatalf("expected agent_id %q", agentID)
	}
	_ = tx2.Rollback()

	// --- ListAITracesByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byTenant, err := tx3.ListAITracesByTenant(ctx, tenantID, store.AITraceQuery{Limit: 10})
	if err != nil {
		t.Fatalf("ListAITracesByTenant: %v", err)
	}
	found := false
	for _, tr := range byTenant {
		if tr.ID == traceID {
			found = true
		}
	}
	if !found {
		t.Fatal("appended trace not in tenant list")
	}
	_ = tx3.Rollback()

	// --- ListAITracesByAgent ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byAgent, err := tx4.ListAITracesByAgent(ctx, agentID, store.AITraceQuery{Limit: 10})
	if err != nil {
		t.Fatalf("ListAITracesByAgent: %v", err)
	}
	found = false
	for _, tr := range byAgent {
		if tr.ID == traceID {
			found = true
		}
	}
	if !found {
		t.Fatal("appended trace not in agent list")
	}
	_ = tx4.Rollback()

	// --- Filter by status ---
	statusFilter := "success"
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byStatus, err := tx5.ListAITracesByTenant(ctx, tenantID, store.AITraceQuery{
		Status: &statusFilter,
		Limit:  10,
	})
	if err != nil {
		t.Fatalf("ListAITracesByTenant with status filter: %v", err)
	}
	for _, tr := range byStatus {
		if tr.Status != "success" {
			t.Fatalf("expected all traces to have status 'success', got %q", tr.Status)
		}
	}
	_ = tx5.Rollback()

	// --- Filter by time window ---
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byWindow, err := tx6.ListAITracesByTenant(ctx, tenantID, store.AITraceQuery{
		Since: &past,
		Until: &future,
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("ListAITracesByTenant with time window: %v", err)
	}
	found = false
	for _, tr := range byWindow {
		if tr.ID == traceID {
			found = true
		}
	}
	if !found {
		t.Fatal("trace not found within expected time window")
	}
	_ = tx6.Rollback()

	// --- ErrAITraceNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetAITrace(ctx, tenantID, "aitrace_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrAITraceNotFound) {
		t.Fatalf("expected ErrAITraceNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Notification Items
// ---------------------------------------------------------------------------

func TestNotificationItem(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Pre-create a tenant and user.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin setup: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "notif-item-tenant", Name: "Notif Item Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	user, err := txSetup.CreateUser(ctx, &store.User{
		Username:     "notif-item-user",
		PasswordHash: "hash",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID
	userID := user.ID

	// --- Append ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	item, err := tx1.AppendNotificationItem(ctx, &store.NotificationItem{
		TenantID: &tenantID,
		UserID:   userID,
		Category: "security",
		Severity: "warn",
		Title:    "Test notification",
		Body:     "This is the body",
		Metadata: `{"key":"value"}`,
	})
	if err != nil {
		t.Fatalf("AppendNotificationItem: %v", err)
	}
	if item.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if item.Title != "Test notification" {
		t.Fatalf("expected title 'Test notification', got %q", item.Title)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	itemID := item.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetNotificationItem(ctx, itemID)
	if err != nil {
		t.Fatalf("GetNotificationItem: %v", err)
	}
	if got.Category != "security" {
		t.Fatalf("expected category 'security', got %q", got.Category)
	}
	if got.ReadAt != nil {
		t.Fatal("expected ReadAt to be nil on new item")
	}
	_ = tx2.Rollback()

	// --- CountUnread ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	count, err := tx3.CountUnreadNotifications(ctx, tenantID, userID)
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if count < 1 {
		t.Fatalf("expected at least 1 unread, got %d", count)
	}
	_ = tx3.Rollback()

	// --- ListByUser (no filter) ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx4.ListNotificationItemsByUser(ctx, tenantID, userID, store.NotificationItemQuery{Limit: 50})
	if err != nil {
		t.Fatalf("ListNotificationItemsByUser: %v", err)
	}
	found := false
	for _, n := range list {
		if n.ID == itemID {
			found = true
		}
	}
	if !found {
		t.Fatal("item not found in list")
	}
	_ = tx4.Rollback()

	// --- ListByUser with category filter ---
	tx4b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byCategory, err := tx4b.ListNotificationItemsByUser(ctx, tenantID, userID, store.NotificationItemQuery{Category: "security", Limit: 50})
	if err != nil {
		t.Fatalf("ListNotificationItemsByUser category filter: %v", err)
	}
	for _, n := range byCategory {
		if n.Category != "security" {
			t.Fatalf("expected category 'security', got %q", n.Category)
		}
	}
	_ = tx4b.Rollback()

	// --- ListByUser with severity filter ---
	tx4c, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	bySeverity, err := tx4c.ListNotificationItemsByUser(ctx, tenantID, userID, store.NotificationItemQuery{Severity: "warn", Limit: 50})
	if err != nil {
		t.Fatalf("ListNotificationItemsByUser severity filter: %v", err)
	}
	for _, n := range bySeverity {
		if n.Severity != "warn" {
			t.Fatalf("expected severity 'warn', got %q", n.Severity)
		}
	}
	_ = tx4c.Rollback()

	// --- ListByUser unread filter ---
	unread := false
	tx4d, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	unreadList, err := tx4d.ListNotificationItemsByUser(ctx, tenantID, userID, store.NotificationItemQuery{Read: &unread, Limit: 50})
	if err != nil {
		t.Fatalf("ListNotificationItemsByUser unread filter: %v", err)
	}
	unreadFound := false
	for _, n := range unreadList {
		if n.ID == itemID {
			unreadFound = true
		}
	}
	if !unreadFound {
		t.Fatal("item not found in unread list before MarkRead")
	}
	_ = tx4d.Rollback()

	// --- MarkRead ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.MarkNotificationRead(ctx, itemID); err != nil {
		t.Fatalf("MarkNotificationRead: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify read_at is set.
	tx5b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterRead, err := tx5b.GetNotificationItem(ctx, itemID)
	if err != nil {
		t.Fatalf("GetNotificationItem after MarkRead: %v", err)
	}
	if afterRead.ReadAt == nil {
		t.Fatal("expected ReadAt to be set after MarkRead")
	}
	_ = tx5b.Rollback()

	// --- Verify read filter returns item after marking read ---
	readTrue := true
	tx5c, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	readList, err := tx5c.ListNotificationItemsByUser(ctx, tenantID, userID, store.NotificationItemQuery{Read: &readTrue, Limit: 50})
	if err != nil {
		t.Fatalf("ListNotificationItemsByUser read=true: %v", err)
	}
	foundRead := false
	for _, n := range readList {
		if n.ID == itemID {
			foundRead = true
		}
	}
	if !foundRead {
		t.Fatal("item not found in read list after MarkRead")
	}
	_ = tx5c.Rollback()

	// --- Append second item for MarkAllRead test ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	item2, err := tx6.AppendNotificationItem(ctx, &store.NotificationItem{
		TenantID: &tenantID,
		UserID:   userID,
		Title:    "Second notification",
	})
	if err != nil {
		t.Fatalf("AppendNotificationItem second: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- MarkAllRead ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.MarkAllNotificationsRead(ctx, tenantID, userID); err != nil {
		t.Fatalf("MarkAllNotificationsRead: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Both items should now be read.
	tx8, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	item2After, err := tx8.GetNotificationItem(ctx, item2.ID)
	if err != nil {
		t.Fatalf("GetNotificationItem item2: %v", err)
	}
	if item2After.ReadAt == nil {
		t.Fatal("expected item2 ReadAt set after MarkAllRead")
	}
	_ = tx8.Rollback()

	// --- Archive ---
	tx9, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx9.ArchiveNotification(ctx, itemID, true); err != nil {
		t.Fatalf("ArchiveNotification(true): %v", err)
	}
	if err := tx9.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify archived.
	tx10, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	archived, err := tx10.GetNotificationItem(ctx, itemID)
	if err != nil {
		t.Fatalf("GetNotificationItem after archive: %v", err)
	}
	if archived.ArchivedAt == nil {
		t.Fatal("expected ArchivedAt set after archive")
	}
	_ = tx10.Rollback()

	// Verify archived filter works.
	archivedTrue := true
	tx10b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	archivedList, err := tx10b.ListNotificationItemsByUser(ctx, tenantID, userID, store.NotificationItemQuery{Archived: &archivedTrue, Limit: 50})
	if err != nil {
		t.Fatalf("ListNotificationItemsByUser archived=true: %v", err)
	}
	foundArchived := false
	for _, n := range archivedList {
		if n.ID == itemID {
			foundArchived = true
		}
	}
	if !foundArchived {
		t.Fatal("item not found in archived list")
	}
	_ = tx10b.Rollback()

	// --- Unarchive ---
	tx11, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx11.ArchiveNotification(ctx, itemID, false); err != nil {
		t.Fatalf("ArchiveNotification(false): %v", err)
	}
	if err := tx11.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	tx12, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	unarchived, err := tx12.GetNotificationItem(ctx, itemID)
	if err != nil {
		t.Fatalf("GetNotificationItem after unarchive: %v", err)
	}
	if unarchived.ArchivedAt != nil {
		t.Fatal("expected ArchivedAt to be nil after unarchive")
	}
	_ = tx12.Rollback()

	// --- ErrNotificationItemNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetNotificationItem(ctx, "notif_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrNotificationItemNotFound) {
		t.Fatalf("expected ErrNotificationItemNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Notification Channels
// ---------------------------------------------------------------------------

func TestNotificationChannel_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin setup: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "notif-chan-tenant", Name: "Notif Chan Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateNotificationChannel(ctx, &store.NotificationChannel{
		TenantID: tenantID,
		Name:     "slack-alerts",
		Kind:     "slack",
		Config:   `{"webhook_url":"https://hooks.slack.com/test"}`,
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Kind != "slack" {
		t.Fatalf("expected kind 'slack', got %q", created.Kind)
	}
	if !created.Enabled {
		t.Fatal("expected enabled=true")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	chanID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetNotificationChannel(ctx, tenantID, chanID)
	if err != nil {
		t.Fatalf("GetNotificationChannel: %v", err)
	}
	if got.Name != "slack-alerts" {
		t.Fatalf("expected name 'slack-alerts', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListNotificationChannelsByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListNotificationChannelsByTenant: %v", err)
	}
	found := false
	for _, c := range list {
		if c.ID == chanID {
			found = true
		}
	}
	if !found {
		t.Fatal("channel not found in list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newName := "slack-alerts-v2"
	newEnabled := false
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateNotificationChannel(ctx, tenantID, chanID, store.UpdateNotificationChannelParams{
		Name:    &newName,
		Enabled: &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateNotificationChannel: %v", err)
	}
	if upd.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, upd.Name)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteNotificationChannel(ctx, tenantID, chanID); err != nil {
		t.Fatalf("DeleteNotificationChannel: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify gone.
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetNotificationChannel(ctx, tenantID, chanID)
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrNotificationChannelNotFound) {
		t.Fatalf("expected ErrNotificationChannelNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Routing Rules
// ---------------------------------------------------------------------------

func TestRoutingRule_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin setup: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "notif-rule-tenant", Name: "Notif Rule Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- Create two rules ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	rule1, err := tx1.CreateRoutingRule(ctx, &store.NotificationRoutingRule{
		TenantID:    tenantID,
		Name:        "rule-one",
		EventFilter: `{"type":"alert"}`,
		ChannelIDs:  `["chan-001"]`,
		Enabled:     true,
		OrderHint:   0,
	})
	if err != nil {
		t.Fatalf("CreateRoutingRule (rule1): %v", err)
	}
	rule2, err := tx1.CreateRoutingRule(ctx, &store.NotificationRoutingRule{
		TenantID:    tenantID,
		Name:        "rule-two",
		EventFilter: `{"type":"info"}`,
		ChannelIDs:  `["chan-002"]`,
		Enabled:     true,
		OrderHint:   1,
	})
	if err != nil {
		t.Fatalf("CreateRoutingRule (rule2): %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	rule1ID := rule1.ID
	rule2ID := rule2.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetRoutingRule(ctx, tenantID, rule1ID)
	if err != nil {
		t.Fatalf("GetRoutingRule: %v", err)
	}
	if got.Name != "rule-one" {
		t.Fatalf("expected name 'rule-one', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List (ordered by order_hint) ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListRoutingRulesByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListRoutingRulesByTenant: %v", err)
	}
	if len(list) < 2 {
		t.Fatalf("expected at least 2 rules, got %d", len(list))
	}
	_ = tx3.Rollback()

	// --- Update ---
	newName := "rule-one-updated"
	newEnabled := false
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdateRoutingRule(ctx, tenantID, rule1ID, store.UpdateRoutingRuleParams{
		Name:    &newName,
		Enabled: &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateRoutingRule: %v", err)
	}
	if upd.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, upd.Name)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Reorder ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.ReorderRoutingRules(ctx, tenantID, []string{rule2ID, rule1ID}); err != nil {
		t.Fatalf("ReorderRoutingRules: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify order_hint changed.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	r2After, err := tx6.GetRoutingRule(ctx, tenantID, rule2ID)
	if err != nil {
		t.Fatalf("GetRoutingRule rule2 after reorder: %v", err)
	}
	if r2After.OrderHint != 0 {
		t.Fatalf("expected rule2 order_hint=0 after reorder, got %d", r2After.OrderHint)
	}
	r1After, err := tx6.GetRoutingRule(ctx, tenantID, rule1ID)
	if err != nil {
		t.Fatalf("GetRoutingRule rule1 after reorder: %v", err)
	}
	if r1After.OrderHint != 1 {
		t.Fatalf("expected rule1 order_hint=1 after reorder, got %d", r1After.OrderHint)
	}
	_ = tx6.Rollback()

	// --- Delete ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DeleteRoutingRule(ctx, tenantID, rule1ID); err != nil {
		t.Fatalf("DeleteRoutingRule: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify gone.
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetRoutingRule(ctx, tenantID, rule1ID)
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrRoutingRuleNotFound) {
		t.Fatalf("expected ErrRoutingRuleNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Delivery Log
// ---------------------------------------------------------------------------

func TestDeliveryLog(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin setup: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "delivery-log-tenant", Name: "Delivery Log Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- Append ---
	now := time.Now().UTC().Truncate(time.Second)
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	entry, err := tx1.AppendDeliveryLogEntry(ctx, &store.NotificationDeliveryLogEntry{
		TenantID:         tenantID,
		Status:           "delivered",
		Attempts:         1,
		FirstAttemptedAt: &now,
		LastAttemptedAt:  &now,
		Metadata:         `{"channel":"email"}`,
	})
	if err != nil {
		t.Fatalf("AppendDeliveryLogEntry: %v", err)
	}
	if entry.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if entry.Status != "delivered" {
		t.Fatalf("expected status 'delivered', got %q", entry.Status)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	entryID := entry.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetDeliveryLogEntry(ctx, tenantID, entryID)
	if err != nil {
		t.Fatalf("GetDeliveryLogEntry: %v", err)
	}
	if got.Attempts != 1 {
		t.Fatalf("expected attempts=1, got %d", got.Attempts)
	}
	if got.FirstAttemptedAt == nil {
		t.Fatal("expected FirstAttemptedAt to be set")
	}
	_ = tx2.Rollback()

	// --- Append a failed entry ---
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	errMsg := "connection refused"
	_, err = tx3.AppendDeliveryLogEntry(ctx, &store.NotificationDeliveryLogEntry{
		TenantID:  tenantID,
		Status:    "failed",
		Attempts:  3,
		LastError: &errMsg,
	})
	if err != nil {
		t.Fatalf("AppendDeliveryLogEntry failed entry: %v", err)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ListByTenant (no filter) ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx4.ListDeliveryLogByTenant(ctx, tenantID, store.DeliveryLogQuery{Limit: 50})
	if err != nil {
		t.Fatalf("ListDeliveryLogByTenant: %v", err)
	}
	if len(list) < 2 {
		t.Fatalf("expected at least 2 entries, got %d", len(list))
	}
	_ = tx4.Rollback()

	// --- ListByTenant with status filter ---
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byStatus, err := tx5.ListDeliveryLogByTenant(ctx, tenantID, store.DeliveryLogQuery{Status: "delivered", Limit: 50})
	if err != nil {
		t.Fatalf("ListDeliveryLogByTenant status filter: %v", err)
	}
	for _, e := range byStatus {
		if e.Status != "delivered" {
			t.Fatalf("expected status 'delivered', got %q", e.Status)
		}
	}
	_ = tx5.Rollback()

	// --- ErrDeliveryLogEntryNotFound ---
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetDeliveryLogEntry(ctx, tenantID, "nlog_nonexistent")
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrDeliveryLogEntryNotFound) {
		t.Fatalf("expected ErrDeliveryLogEntryNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Tenant Notification Config
// ---------------------------------------------------------------------------

func TestTenantNotificationConfig(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin setup: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "notif-config-tenant", Name: "Notif Config Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// --- Get before upsert (should return defaults) ---
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	defaults, err := tx1.GetTenantNotificationConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetTenantNotificationConfig (pre-upsert): %v", err)
	}
	if !defaults.Enabled {
		t.Fatal("expected default Enabled=true")
	}
	if defaults.MaxRetries != 3 {
		t.Fatalf("expected default MaxRetries=3, got %d", defaults.MaxRetries)
	}
	_ = tx1.Rollback()

	// --- Upsert ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upserted, err := tx2.UpsertTenantNotificationConfig(ctx, &store.TenantNotificationConfig{
		TenantID:            tenantID,
		Enabled:             false,
		OptInMode:           "opt-out",
		MaxRetries:          5,
		RetryBackoffSeconds: 60,
		ChannelPriority:     `["email","slack"]`,
	})
	if err != nil {
		t.Fatalf("UpsertTenantNotificationConfig: %v", err)
	}
	if upserted.Enabled {
		t.Fatal("expected Enabled=false after upsert")
	}
	if upserted.MaxRetries != 5 {
		t.Fatalf("expected MaxRetries=5, got %d", upserted.MaxRetries)
	}
	if upserted.OptInMode != "opt-out" {
		t.Fatalf("expected OptInMode='opt-out', got %q", upserted.OptInMode)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Verify persisted ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetTenantNotificationConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetTenantNotificationConfig after upsert: %v", err)
	}
	if got.Enabled {
		t.Fatal("expected Enabled=false persisted")
	}
	if got.RetryBackoffSeconds != 60 {
		t.Fatalf("expected RetryBackoffSeconds=60, got %d", got.RetryBackoffSeconds)
	}
	_ = tx3.Rollback()

	// --- Second upsert overwrites ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upserted2, err := tx4.UpsertTenantNotificationConfig(ctx, &store.TenantNotificationConfig{
		TenantID:            tenantID,
		Enabled:             true,
		OptInMode:           "opt-in",
		MaxRetries:          2,
		RetryBackoffSeconds: 15,
		ChannelPriority:     `["slack"]`,
	})
	if err != nil {
		t.Fatalf("UpsertTenantNotificationConfig second: %v", err)
	}
	if !upserted2.Enabled {
		t.Fatal("expected Enabled=true after second upsert")
	}
	if upserted2.MaxRetries != 2 {
		t.Fatalf("expected MaxRetries=2, got %d", upserted2.MaxRetries)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

func TestPlugin_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Global-scope plugins (tenantID = "" → tenant_scope IS NULL).
	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreatePlugin(ctx, &store.Plugin{
		Slug:       "my-plugin",
		Name:       "My Plugin",
		Version:    "1.0.0",
		Enabled:    true,
		BuildState: "stable",
	})
	if err != nil {
		t.Fatalf("CreatePlugin: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if created.Slug != "my-plugin" {
		t.Fatalf("expected slug 'my-plugin', got %q", created.Slug)
	}
	if !created.Enabled {
		t.Fatal("expected enabled=true")
	}
	if created.TenantScope != nil {
		t.Fatal("expected TenantScope=nil for global plugin")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	pluginID := created.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetPlugin(ctx, "", pluginID)
	if err != nil {
		t.Fatalf("GetPlugin: %v", err)
	}
	if got.Name != "My Plugin" {
		t.Fatalf("expected name 'My Plugin', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- ListByScope (global) ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListPluginsByScope(ctx, "")
	if err != nil {
		t.Fatalf("ListPluginsByScope: %v", err)
	}
	found := false
	for _, p := range list {
		if p.ID == pluginID {
			found = true
		}
	}
	if !found {
		t.Fatal("plugin not found in global list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newName := "My Plugin v2"
	newVersion := "2.0.0"
	newEnabled := false
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdatePlugin(ctx, "", pluginID, store.UpdatePluginParams{
		Name:    &newName,
		Version: &newVersion,
		Enabled: &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdatePlugin: %v", err)
	}
	if upd.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, upd.Name)
	}
	if upd.Version != newVersion {
		t.Fatalf("expected version %q, got %q", newVersion, upd.Version)
	}
	if upd.Enabled {
		t.Fatal("expected enabled=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Tenant-scoped plugin ---
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin setup: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "plugin-tenant", Name: "Plugin Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	scopedPlugin, err := tx5.CreatePlugin(ctx, &store.Plugin{
		TenantScope: &tenantID,
		Slug:        "tenant-plugin",
		Name:        "Tenant Plugin",
		Version:     "1.0.0",
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("CreatePlugin (tenant-scoped): %v", err)
	}
	if scopedPlugin.TenantScope == nil || *scopedPlugin.TenantScope != tenantID {
		t.Fatal("expected TenantScope to match tenant ID")
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	scopedPluginID := scopedPlugin.ID

	// ListByScope for the specific tenant should find the scoped plugin but not the global one.
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenantList, err := tx6.ListPluginsByScope(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListPluginsByScope(tenantID): %v", err)
	}
	foundScoped := false
	for _, p := range tenantList {
		if p.ID == scopedPluginID {
			foundScoped = true
		}
		// Global plugin should NOT appear in tenant-scoped list
		if p.ID == pluginID {
			t.Fatal("global plugin should not appear in tenant-scoped ListByScope")
		}
	}
	if !foundScoped {
		t.Fatal("scoped plugin not found in tenant list")
	}
	_ = tx6.Rollback()

	// --- Delete ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DeletePlugin(ctx, "", pluginID); err != nil {
		t.Fatalf("DeletePlugin: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify gone.
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetPlugin(ctx, "", pluginID)
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrPluginNotFound) {
		t.Fatalf("expected ErrPluginNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Plugin Signers
// ---------------------------------------------------------------------------

func TestPluginSigner_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// --- Create signer (global scope) ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	signer, err := tx1.CreatePluginSigner(ctx, &store.PluginSigner{
		Name:        "Test Signer",
		Fingerprint: "sha256:abcdef1234567890abcdef1234567890abcdef12",
		Status:      "verified",
		Notes:       "Main signing key",
	})
	if err != nil {
		t.Fatalf("CreatePluginSigner: %v", err)
	}
	if signer.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if signer.Status != "verified" {
		t.Fatalf("expected status 'verified', got %q", signer.Status)
	}
	if signer.TenantScope != nil {
		t.Fatal("expected global signer TenantScope=nil")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	signerID := signer.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetPluginSigner(ctx, "", signerID)
	if err != nil {
		t.Fatalf("GetPluginSigner: %v", err)
	}
	if got.Fingerprint != "sha256:abcdef1234567890abcdef1234567890abcdef12" {
		t.Fatalf("fingerprint mismatch: %q", got.Fingerprint)
	}
	_ = tx2.Rollback()

	// --- ListByScope ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListPluginSignersByScope(ctx, "")
	if err != nil {
		t.Fatalf("ListPluginSignersByScope: %v", err)
	}
	found := false
	for _, s := range list {
		if s.ID == signerID {
			found = true
		}
	}
	if !found {
		t.Fatal("signer not found in global list")
	}
	_ = tx3.Rollback()

	// --- Update ---
	newStatus := "revoked"
	newNotes := "Key compromised"
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upd, err := tx4.UpdatePluginSigner(ctx, "", signerID, store.UpdatePluginSignerParams{
		Status: &newStatus,
		Notes:  &newNotes,
	})
	if err != nil {
		t.Fatalf("UpdatePluginSigner: %v", err)
	}
	if upd.Status != newStatus {
		t.Fatalf("expected status %q, got %q", newStatus, upd.Status)
	}
	if upd.Notes != newNotes {
		t.Fatalf("expected notes %q, got %q", newNotes, upd.Notes)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create plugin linked to signer (for ListPluginsBySigner) ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	signedPlugin, err := tx5.CreatePlugin(ctx, &store.Plugin{
		Slug:           "signed-plugin",
		Name:           "Signed Plugin",
		Version:        "1.0.0",
		SignerID:       &signerID,
		CosignVerified: true,
	})
	if err != nil {
		t.Fatalf("CreatePlugin with signer: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ListPluginsBySigner ---
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	bySignerList, err := tx6.ListPluginsBySigner(ctx, signerID)
	if err != nil {
		t.Fatalf("ListPluginsBySigner: %v", err)
	}
	foundSigned := false
	for _, p := range bySignerList {
		if p.ID == signedPlugin.ID {
			foundSigned = true
		}
	}
	if !foundSigned {
		t.Fatal("signed plugin not found in ListPluginsBySigner result")
	}
	_ = tx6.Rollback()

	// --- Delete ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DeletePluginSigner(ctx, "", signerID); err != nil {
		t.Fatalf("DeletePluginSigner: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Verify gone.
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetPluginSigner(ctx, "", signerID)
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrPluginSignerNotFound) {
		t.Fatalf("expected ErrPluginSignerNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// PKI / TLS tests
// ---------------------------------------------------------------------------

func TestCertAuthority_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Create tenant.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "ca-tenant", Name: "CA Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// Create.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ca, err := tx1.CreateCertAuthority(ctx, &store.CertAuthority{
		TenantID:       tenantID,
		Name:           "test-ca",
		Kind:           "internal",
		Subject:        "CN=Test CA",
		CertificatePEM: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
	})
	if err != nil {
		t.Fatalf("CreateCertAuthority: %v", err)
	}
	if ca.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if ca.Name != "test-ca" {
		t.Fatalf("expected name test-ca, got %q", ca.Name)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	caID := ca.ID

	// Get.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetCertAuthority(ctx, tenantID, caID)
	if err != nil {
		t.Fatalf("GetCertAuthority: %v", err)
	}
	if got.Kind != "internal" {
		t.Fatalf("expected kind internal, got %q", got.Kind)
	}
	_ = tx2.Rollback()

	// List.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListCertAuthoritiesByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListCertAuthoritiesByTenant: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 CA, got %d", len(list))
	}
	_ = tx3.Rollback()

	// Update.
	newKind := "external"
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	updated, err := tx4.UpdateCertAuthority(ctx, tenantID, caID, store.UpdateCertAuthorityParams{Kind: &newKind})
	if err != nil {
		t.Fatalf("UpdateCertAuthority: %v", err)
	}
	if updated.Kind != "external" {
		t.Fatalf("expected kind external, got %q", updated.Kind)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Duplicate name error.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, dupErr := tx5.CreateCertAuthority(ctx, &store.CertAuthority{
		TenantID: tenantID, Name: "test-ca", Kind: "internal", Subject: "CN=Dup",
		CertificatePEM: "x",
	})
	_ = tx5.Rollback()
	if !errors.Is(dupErr, store.ErrCertAuthorityNameTaken) {
		t.Fatalf("expected ErrCertAuthorityNameTaken, got %v", dupErr)
	}

	// Delete.
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteCertAuthority(ctx, tenantID, caID); err != nil {
		t.Fatalf("DeleteCertAuthority: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Not found.
	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetCertAuthority(ctx, tenantID, caID)
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrCertAuthorityNotFound) {
		t.Fatalf("expected ErrCertAuthorityNotFound, got %v", nfErr)
	}
}

func TestCertEnrollment_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Create tenant + CA.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "enroll-tenant", Name: "Enroll Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	ca, err := txSetup.CreateCertAuthority(ctx, &store.CertAuthority{
		TenantID: tenant.ID, Name: "enroll-ca", Kind: "internal", Subject: "CN=Enroll CA",
		CertificatePEM: "x",
	})
	if err != nil {
		t.Fatalf("CreateCertAuthority: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID
	caID := ca.ID

	// Create enrollment.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	enroll, err := tx1.CreateCertEnrollment(ctx, &store.CertEnrollment{
		TenantID: tenantID,
		CAID:     &caID,
		Subject:  "CN=test.example.com",
		DNSSANs:  `["test.example.com"]`,
	})
	if err != nil {
		t.Fatalf("CreateCertEnrollment: %v", err)
	}
	if enroll.State != "pending" {
		t.Fatalf("expected state pending, got %q", enroll.State)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	enrollID := enroll.ID

	// Get.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetCertEnrollment(ctx, tenantID, enrollID)
	if err != nil {
		t.Fatalf("GetCertEnrollment: %v", err)
	}
	if got.Subject != "CN=test.example.com" {
		t.Fatalf("unexpected subject: %q", got.Subject)
	}
	_ = tx2.Rollback()

	// List.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListCertEnrollmentsByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListCertEnrollmentsByTenant: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 enrollment, got %d", len(list))
	}
	_ = tx3.Rollback()

	// Update.
	newState := "issued"
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	updated, err := tx4.UpdateCertEnrollment(ctx, tenantID, enrollID, store.UpdateCertEnrollmentParams{State: &newState})
	if err != nil {
		t.Fatalf("UpdateCertEnrollment: %v", err)
	}
	if updated.State != "issued" {
		t.Fatalf("expected state issued, got %q", updated.State)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Revoke.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	revoked, err := tx5.RevokeCertEnrollmentRow(ctx, tenantID, enrollID, "test-revocation")
	if err != nil {
		t.Fatalf("RevokeCertEnrollmentRow: %v", err)
	}
	if revoked.State != "revoked" {
		t.Fatalf("expected state revoked, got %q", revoked.State)
	}
	if revoked.RevokedAt == nil {
		t.Fatal("expected RevokedAt to be set")
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

func TestTLSCertificate_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "tlscert-tenant", Name: "TLS Cert Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// Create.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	cert, err := tx1.CreateTLSCertificate(ctx, &store.TLSCertificate{
		TenantID:       tenantID,
		Domain:         "example.com",
		Issuer:         "Let's Encrypt",
		Source:         "acme",
		AutoRenew:      true,
		CertificatePEM: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
	})
	if err != nil {
		t.Fatalf("CreateTLSCertificate: %v", err)
	}
	if cert.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if !cert.AutoRenew {
		t.Fatal("expected AutoRenew=true")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	certID := cert.ID

	// Get.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetTLSCertificate(ctx, tenantID, certID)
	if err != nil {
		t.Fatalf("GetTLSCertificate: %v", err)
	}
	if got.Domain != "example.com" {
		t.Fatalf("expected domain example.com, got %q", got.Domain)
	}
	_ = tx2.Rollback()

	// List.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListTLSCertificatesByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListTLSCertificatesByTenant: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 cert, got %d", len(list))
	}
	_ = tx3.Rollback()

	// Update (flip AutoRenew).
	autoRenewOff := false
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	updated, err := tx4.UpdateTLSCertificate(ctx, tenantID, certID, store.UpdateTLSCertificateParams{AutoRenew: &autoRenewOff})
	if err != nil {
		t.Fatalf("UpdateTLSCertificate: %v", err)
	}
	if updated.AutoRenew {
		t.Fatal("expected AutoRenew=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Duplicate domain.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, dupErr := tx5.CreateTLSCertificate(ctx, &store.TLSCertificate{
		TenantID: tenantID, Domain: "example.com", Issuer: "x", CertificatePEM: "x",
	})
	_ = tx5.Rollback()
	if !errors.Is(dupErr, store.ErrTLSCertificateTaken) {
		t.Fatalf("expected ErrTLSCertificateTaken, got %v", dupErr)
	}

	// Delete.
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteTLSCertificate(ctx, tenantID, certID); err != nil {
		t.Fatalf("DeleteTLSCertificate: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetTLSCertificate(ctx, tenantID, certID)
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrTLSCertificateNotFound) {
		t.Fatalf("expected ErrTLSCertificateNotFound, got %v", nfErr)
	}
}

func TestTLSConfig(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "tlscfg-tenant", Name: "TLS Config Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// Get default (no row).
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetTLSConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetTLSConfig (default): %v", err)
	}
	if def.ACMEProvider != "lets-encrypt" {
		t.Fatalf("expected default provider lets-encrypt, got %q", def.ACMEProvider)
	}
	if def.MinProtocol != "1.2" {
		t.Fatalf("expected default min_protocol 1.2, got %q", def.MinProtocol)
	}
	_ = tx1.Rollback()

	// Upsert.
	email := "admin@example.com"
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upserted, err := tx2.UpsertTLSConfig(ctx, &store.TLSConfig{
		TenantID:       tenantID,
		ACMEProvider:   "zerossl",
		ACMEEmail:      email,
		MinProtocol:    "1.3",
		AllowedCiphers: `["TLS_AES_256_GCM_SHA384"]`,
	})
	if err != nil {
		t.Fatalf("UpsertTLSConfig: %v", err)
	}
	if upserted.ACMEProvider != "zerossl" {
		t.Fatalf("expected provider zerossl, got %q", upserted.ACMEProvider)
	}
	if upserted.MinProtocol != "1.3" {
		t.Fatalf("expected min_protocol 1.3, got %q", upserted.MinProtocol)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get after upsert.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetTLSConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetTLSConfig: %v", err)
	}
	if got.ACMEProvider != "zerossl" {
		t.Fatalf("expected provider zerossl after upsert, got %q", got.ACMEProvider)
	}
	_ = tx3.Rollback()
}

// ---------------------------------------------------------------------------
// Settings config singleton tests
// ---------------------------------------------------------------------------

func TestNetworkConfig(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "netcfg-tenant", Name: "NetCfg Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// Get default.
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetNetworkConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetNetworkConfig (default): %v", err)
	}
	if def.ReadTimeoutSeconds != 60 {
		t.Fatalf("expected read_timeout=60, got %d", def.ReadTimeoutSeconds)
	}
	if def.HTTP3Enabled {
		t.Fatal("expected HTTP3Enabled=false by default")
	}
	_ = tx1.Rollback()

	// Upsert.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	up, err := tx2.UpsertNetworkConfig(ctx, &store.NetworkConfig{
		TenantID:             tenantID,
		ListenAddresses:      `[":443"]`,
		HTTP3Enabled:         true,
		CaddyConfigOverrides: `{}`,
		ReadTimeoutSeconds:   30,
		WriteTimeoutSeconds:  30,
		IdleTimeoutSeconds:   60,
	})
	if err != nil {
		t.Fatalf("UpsertNetworkConfig: %v", err)
	}
	if !up.HTTP3Enabled {
		t.Fatal("expected HTTP3Enabled=true after upsert")
	}
	if up.ReadTimeoutSeconds != 30 {
		t.Fatalf("expected read_timeout=30, got %d", up.ReadTimeoutSeconds)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get after upsert.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetNetworkConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetNetworkConfig: %v", err)
	}
	if !got.HTTP3Enabled {
		t.Fatal("expected HTTP3Enabled=true after upsert+get")
	}
	_ = tx3.Rollback()
}

func TestTenantAuthPolicy(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "authpol-tenant", Name: "AuthPol Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// Get default.
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetTenantAuthPolicy(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetTenantAuthPolicy (default): %v", err)
	}
	if def.TOTPPolicy != "optional" {
		t.Fatalf("expected totp_policy=optional, got %q", def.TOTPPolicy)
	}
	if def.MinLength != 12 {
		t.Fatalf("expected min_length=12, got %d", def.MinLength)
	}
	_ = tx1.Rollback()

	// Upsert.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	up, err := tx2.UpsertTenantAuthPolicy(ctx, &store.TenantAuthPolicy{
		TenantID:          tenantID,
		TOTPPolicy:        "all",
		MinLength:         16,
		RequireUppercase:  true,
		RequireDigit:      true,
		IdleHours:         8,
		AbsoluteHours:     72,
		MaxFailedAttempts: 3,
		LockoutMinutes:    30,
	})
	if err != nil {
		t.Fatalf("UpsertTenantAuthPolicy: %v", err)
	}
	if up.TOTPPolicy != "all" {
		t.Fatalf("expected totp_policy=all, got %q", up.TOTPPolicy)
	}
	if !up.RequireUppercase {
		t.Fatal("expected RequireUppercase=true")
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get after upsert.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetTenantAuthPolicy(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetTenantAuthPolicy: %v", err)
	}
	if got.MinLength != 16 {
		t.Fatalf("expected min_length=16 after upsert, got %d", got.MinLength)
	}
	_ = tx3.Rollback()
}

func TestObservabilityConfig(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "obscfg-tenant", Name: "ObsCfg Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// Get default.
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetObservabilityConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetObservabilityConfig (default): %v", err)
	}
	if def.TracesSampleRate != 1.0 {
		t.Fatalf("expected sample_rate=1.0, got %f", def.TracesSampleRate)
	}
	if def.LogFormat != "json" {
		t.Fatalf("expected log_format=json, got %q", def.LogFormat)
	}
	_ = tx1.Rollback()

	// Upsert.
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	up, err := tx2.UpsertObservabilityConfig(ctx, &store.ObservabilityConfig{
		TenantID:             tenantID,
		MetricsScrapeAuth:    `{}`,
		MetricsRetentionDays: 14,
		LogLevels:            `{}`,
		LogFormat:            "text",
		LogRotation:          `{}`,
		TracesRetentionDays:  3,
		TracesSampleRate:     0.5,
	})
	if err != nil {
		t.Fatalf("UpsertObservabilityConfig: %v", err)
	}
	if up.TracesSampleRate != 0.5 {
		t.Fatalf("expected sample_rate=0.5, got %f", up.TracesSampleRate)
	}
	if up.LogFormat != "text" {
		t.Fatalf("expected log_format=text, got %q", up.LogFormat)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get after upsert.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetObservabilityConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetObservabilityConfig: %v", err)
	}
	if got.MetricsRetentionDays != 14 {
		t.Fatalf("expected retention=14, got %d", got.MetricsRetentionDays)
	}
	_ = tx3.Rollback()
}

func TestAuditRetentionConfig(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "audret-tenant", Name: "AuditRet Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// Get default.
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetAuditRetentionConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetAuditRetentionConfig (default): %v", err)
	}
	if def.RetentionDaysRead != 30 {
		t.Fatalf("expected read=30, got %d", def.RetentionDaysRead)
	}
	if def.AutoExport != "never" {
		t.Fatalf("expected auto_export=never, got %q", def.AutoExport)
	}
	_ = tx1.Rollback()

	// Upsert.
	dest := "s3://my-bucket/audit"
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	up, err := tx2.UpsertAuditRetentionConfig(ctx, &store.AuditRetentionConfig{
		TenantID:                 tenantID,
		RetentionDaysRead:        60,
		RetentionDaysWrite:       180,
		RetentionDaysDestructive: 730,
		AutoExport:               "weekly",
		AutoExportFormat:         "csv",
		AutoExportDestination:    &dest,
	})
	if err != nil {
		t.Fatalf("UpsertAuditRetentionConfig: %v", err)
	}
	if up.AutoExport != "weekly" {
		t.Fatalf("expected auto_export=weekly, got %q", up.AutoExport)
	}
	if up.AutoExportDestination == nil || *up.AutoExportDestination != dest {
		t.Fatalf("unexpected destination: %v", up.AutoExportDestination)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Get after upsert.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetAuditRetentionConfig(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetAuditRetentionConfig: %v", err)
	}
	if got.RetentionDaysRead != 60 {
		t.Fatalf("expected read=60, got %d", got.RetentionDaysRead)
	}
	_ = tx3.Rollback()
}

// ---------------------------------------------------------------------------
// Webhook endpoint tests
// ---------------------------------------------------------------------------

func TestWebhookEndpoint_CRUD(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txSetup.CreateTenant(ctx, &store.Tenant{Slug: "hook-tenant", Name: "Hook Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	tenantID := tenant.ID

	// Create.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ep, err := tx1.CreateWebhookEndpoint(ctx, &store.WebhookEndpoint{
		TenantID: tenantID,
		Name:     "my-hook",
		URL:      "https://example.com/hook",
		Enabled:  true,
		Events:   `["route.created"]`,
	})
	if err != nil {
		t.Fatalf("CreateWebhookEndpoint: %v", err)
	}
	if ep.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if !ep.Enabled {
		t.Fatal("expected Enabled=true")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	epID := ep.ID

	// Get.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetWebhookEndpoint(ctx, tenantID, epID)
	if err != nil {
		t.Fatalf("GetWebhookEndpoint: %v", err)
	}
	if got.URL != "https://example.com/hook" {
		t.Fatalf("unexpected URL: %q", got.URL)
	}
	_ = tx2.Rollback()

	// List.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListWebhookEndpointsByTenant(ctx, tenantID)
	if err != nil {
		t.Fatalf("ListWebhookEndpointsByTenant: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 webhook, got %d", len(list))
	}
	_ = tx3.Rollback()

	// Update.
	newURL := "https://example.com/hook-v2"
	enabled := false
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	updated, err := tx4.UpdateWebhookEndpoint(ctx, tenantID, epID, store.UpdateWebhookEndpointParams{
		URL:     &newURL,
		Enabled: &enabled,
	})
	if err != nil {
		t.Fatalf("UpdateWebhookEndpoint: %v", err)
	}
	if updated.URL != newURL {
		t.Fatalf("expected URL %q, got %q", newURL, updated.URL)
	}
	if updated.Enabled {
		t.Fatal("expected Enabled=false after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Duplicate name.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, dupErr := tx5.CreateWebhookEndpoint(ctx, &store.WebhookEndpoint{
		TenantID: tenantID, Name: "my-hook", URL: "https://other.com/hook",
	})
	_ = tx5.Rollback()
	if !errors.Is(dupErr, store.ErrWebhookEndpointNameTaken) {
		t.Fatalf("expected ErrWebhookEndpointNameTaken, got %v", dupErr)
	}

	// Delete.
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteWebhookEndpoint(ctx, tenantID, epID); err != nil {
		t.Fatalf("DeleteWebhookEndpoint: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txNF, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, nfErr := txNF.GetWebhookEndpoint(ctx, tenantID, epID)
	_ = txNF.Rollback()
	if !errors.Is(nfErr, store.ErrWebhookEndpointNotFound) {
		t.Fatalf("expected ErrWebhookEndpointNotFound, got %v", nfErr)
	}
}

// ---------------------------------------------------------------------------
// Cluster enrollment token tests
// ---------------------------------------------------------------------------

func TestEnrollmentToken(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	expiry := time.Now().UTC().Add(24 * time.Hour)

	// Create.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tok, err := tx1.CreateEnrollmentToken(ctx, &store.ClusterEnrollmentToken{
		TokenHash: "sha256-abc123",
		ExpiresAt: expiry,
		Notes:     "test token",
	})
	if err != nil {
		t.Fatalf("CreateEnrollmentToken: %v", err)
	}
	if tok.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if tok.ConsumedAt != nil {
		t.Fatal("expected ConsumedAt=nil")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// GetByHash.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byHash, err := tx2.GetEnrollmentTokenByHash(ctx, "sha256-abc123")
	if err != nil {
		t.Fatalf("GetEnrollmentTokenByHash: %v", err)
	}
	if byHash.ID != tok.ID {
		t.Fatalf("ID mismatch: %q vs %q", byHash.ID, tok.ID)
	}
	_ = tx2.Rollback()

	// ListActive — should have 1.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	active, err := tx3.ListActiveEnrollmentTokens(ctx)
	if err != nil {
		t.Fatalf("ListActiveEnrollmentTokens: %v", err)
	}
	found := false
	for _, at := range active {
		if at.ID == tok.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("expected token in active list")
	}
	_ = tx3.Rollback()

	// Consume.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	consumed, err := tx4.ConsumeEnrollmentToken(ctx, "sha256-abc123", "node-001")
	if err != nil {
		t.Fatalf("ConsumeEnrollmentToken: %v", err)
	}
	if consumed.ConsumedAt == nil {
		t.Fatal("expected ConsumedAt to be set")
	}
	if consumed.ConsumedByNodeID == nil || *consumed.ConsumedByNodeID != "node-001" {
		t.Fatalf("unexpected ConsumedByNodeID: %v", consumed.ConsumedByNodeID)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Consume again — should fail with AlreadyUsed.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, alreadyErr := tx5.ConsumeEnrollmentToken(ctx, "sha256-abc123", "node-002")
	_ = tx5.Rollback()
	if !errors.Is(alreadyErr, store.ErrEnrollmentTokenAlreadyUsed) {
		t.Fatalf("expected ErrEnrollmentTokenAlreadyUsed, got %v", alreadyErr)
	}

	// Create a second token and revoke it.
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tok2, err := tx6.CreateEnrollmentToken(ctx, &store.ClusterEnrollmentToken{
		TokenHash: "sha256-def456",
		ExpiresAt: expiry,
		Notes:     "revoke me",
	})
	if err != nil {
		t.Fatalf("CreateEnrollmentToken (tok2): %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.RevokeEnrollmentToken(ctx, tok2.ID); err != nil {
		t.Fatalf("RevokeEnrollmentToken: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Revoke again — should fail AlreadyUsed.
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	revokeAgainErr := tx8.RevokeEnrollmentToken(ctx, tok2.ID)
	_ = tx8.Rollback()
	if !errors.Is(revokeAgainErr, store.ErrEnrollmentTokenAlreadyUsed) {
		t.Fatalf("expected ErrEnrollmentTokenAlreadyUsed on re-revoke, got %v", revokeAgainErr)
	}

	// ListActive after revoke — tok2 should not appear.
	tx9, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	active2, err := tx9.ListActiveEnrollmentTokens(ctx)
	if err != nil {
		t.Fatalf("ListActiveEnrollmentTokens: %v", err)
	}
	for _, at := range active2 {
		if at.ID == tok2.ID {
			t.Fatal("revoked token should not appear in active list")
		}
	}
	_ = tx9.Rollback()
}

// ---------------------------------------------------------------------------
// Impersonation session tests
// ---------------------------------------------------------------------------

func TestImpersonationSession(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	// Create a user to act as super admin.
	txSetup, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	email := "superadmin@example.com"
	superAdmin, err := txSetup.CreateUser(ctx, &store.User{
		Username: "superadmin", Email: &email, PasswordHash: "x", Status: "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := txSetup.Commit(); err != nil {
		t.Fatalf("Commit setup: %v", err)
	}
	superAdminID := superAdmin.ID

	expiry := time.Now().UTC().Add(2 * time.Hour)

	// Create session.
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sess, err := tx1.CreateImpersonationSession(ctx, &store.ImpersonationSession{
		SuperAdminID: superAdminID,
		Reason:       "support ticket #1234",
		ExpiresAt:    expiry,
	})
	if err != nil {
		t.Fatalf("CreateImpersonationSession: %v", err)
	}
	if sess.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if sess.EndedAt != nil {
		t.Fatal("expected EndedAt=nil")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	sessID := sess.ID

	// Get.
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetImpersonationSession(ctx, sessID)
	if err != nil {
		t.Fatalf("GetImpersonationSession: %v", err)
	}
	if got.Reason != "support ticket #1234" {
		t.Fatalf("unexpected reason: %q", got.Reason)
	}
	_ = tx2.Rollback()

	// ListActive — should contain session.
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	active, err := tx3.ListActiveImpersonationSessions(ctx)
	if err != nil {
		t.Fatalf("ListActiveImpersonationSessions: %v", err)
	}
	found := false
	for _, s := range active {
		if s.ID == sessID {
			found = true
		}
	}
	if !found {
		t.Fatal("expected session in active list")
	}
	_ = tx3.Rollback()

	// Touch — verify last_active_at advances.
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.TouchImpersonationSession(ctx, sessID); err != nil {
		t.Fatalf("TouchImpersonationSession: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx4b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	afterTouch, err := tx4b.GetImpersonationSession(ctx, sessID)
	if err != nil {
		t.Fatalf("GetImpersonationSession after Touch: %v", err)
	}
	if afterTouch.LastActiveAt == nil {
		t.Fatal("expected LastActiveAt to be set after Touch")
	}
	_ = tx4b.Rollback()

	// End session.
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ended, err := tx5.EndImpersonationSession(ctx, sessID, "explicit_exit")
	if err != nil {
		t.Fatalf("EndImpersonationSession: %v", err)
	}
	if ended.EndedAt == nil {
		t.Fatal("expected EndedAt to be set")
	}
	if ended.EndReason == nil || *ended.EndReason != "explicit_exit" {
		t.Fatalf("unexpected end_reason: %v", ended.EndReason)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// End again — should fail with SessionEnded.
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, endAgainErr := tx6.EndImpersonationSession(ctx, sessID, "other")
	_ = tx6.Rollback()
	if !errors.Is(endAgainErr, store.ErrImpersonationSessionEnded) {
		t.Fatalf("expected ErrImpersonationSessionEnded, got %v", endAgainErr)
	}

	// ListActive after End — should not contain session.
	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	active2, err := tx7.ListActiveImpersonationSessions(ctx)
	if err != nil {
		t.Fatalf("ListActiveImpersonationSessions: %v", err)
	}
	for _, s := range active2 {
		if s.ID == sessID {
			t.Fatal("ended session should not appear in active list")
		}
	}
	_ = tx7.Rollback()

	// Touch on ended session — should fail.
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	touchEndedErr := tx8.TouchImpersonationSession(ctx, sessID)
	_ = tx8.Rollback()
	if !errors.Is(touchEndedErr, store.ErrImpersonationSessionNotFound) {
		t.Fatalf("expected ErrImpersonationSessionNotFound on Touch of ended session, got %v", touchEndedErr)
	}
}

// TestPostgres_Service_CaddyPrimitives_RoundTrip verifies that Phase 7a / #161
// service-level Caddy primitive fields persist and round-trip through the
// Postgres driver. Skipped when POSTGRES_TEST_DSN is unset.
func TestPostgres_Service_CaddyPrimitives_RoundTrip(t *testing.T) {
	d := openPGTestDB(t)
	ctx := context.Background()

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	created, err := tx.CreateService(ctx, &riokuv1.Service{
		Name:     "pg-prim-svc",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "10.0.0.1:8080", Weight: 1, Healthy: true},
		},
		RequestHeaders: &riokuv1.RequestHeaders{
			Set:    map[string]string{"X-Custom": "v1"},
			Delete: []string{"X-Internal"},
		},
		ResponseHeaders: &riokuv1.ResponseHeaders{
			Set: map[string]string{"X-Frame-Options": "DENY"},
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

	// ResponseRules
	rules := got.GetResponseRules()
	if len(rules) != 1 {
		t.Fatalf("response_rules len = %d, want 1", len(rules))
	}
	if rules[0].GetMatchStatusCodes()[0] != "5xx" {
		t.Errorf("response_rules[0].match_status_codes = %v, want [5xx]", rules[0].GetMatchStatusCodes())
	}
	ep, ok := rules[0].GetAction().(*riokuv1.ResponseRule_ServeErrorPage)
	if !ok {
		t.Fatalf("response_rules[0].action is %T, want ServeErrorPage", rules[0].GetAction())
	}
	if ep.ServeErrorPage.GetStatusCode() != 503 {
		t.Errorf("serve_error_page.status_code = %d, want 503", ep.ServeErrorPage.GetStatusCode())
	}

	// Compression
	comp := got.GetCompression()
	if comp == nil {
		t.Fatal("compression is nil after round-trip")
	}
	if !comp.GetEnabled() {
		t.Error("compression.enabled = false, want true")
	}
	if comp.GetMinLength() != 1024 {
		t.Errorf("compression.min_length = %d, want 1024", comp.GetMinLength())
	}
}
