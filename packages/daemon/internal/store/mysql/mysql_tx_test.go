package mysql_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/mysql"
)

// openMySQLTestDB opens a MySQL driver using MYSQL_TEST_DSN, runs MigrateUp,
// and registers cleanup that runs MigrateDown then closes the driver.
// The test is skipped when MYSQL_TEST_DSN is unset.
func openMySQLTestDB(t *testing.T) store.Driver {
	t.Helper()
	dsn := os.Getenv("MYSQL_TEST_DSN")
	if dsn == "" {
		t.Skip("MYSQL_TEST_DSN not set; skipping MySQL integration test")
	}

	ctx := context.Background()
	d, err := store.New("mysql")
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
func TestMySQL_Route_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
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

// TestMySQL_Service_CRUD exercises Create → Get → List → Update (upstream replacement) → Delete.
// Also verifies the N+1-fix batch-upstream path in ListServices.
func TestMySQL_Service_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
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

// TestMySQL_Policy_CRUD exercises Create → Get → List → Update → Delete for policies.
func TestMySQL_Policy_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
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

// TestMySQL_PolicyBindings exercises AttachPolicy → ListPoliciesByTarget → DetachPolicy.
func TestMySQL_PolicyBindings(t *testing.T) {
	d := openMySQLTestDB(t)
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

// createTestUser inserts a minimal user row and returns the ID.
// Used by tests that need a pre-existing user for FK constraints.
func createTestUser(t *testing.T, d store.Driver, username string) string {
	t.Helper()
	ctx := context.Background()
	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("createTestUser Begin: %v", err)
	}
	u, err := tx.CreateUser(ctx, &store.User{
		Username:     username,
		PasswordHash: "hash-" + username,
		Status:       "active",
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("createTestUser CreateUser: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("createTestUser Commit: %v", err)
	}
	return u.ID
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

func TestMySQL_APIKey_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	ownerID := createTestUser(t, d, "apikey-owner")

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	keyID, err := tx1.CreateAPIKey(ctx, "my-key", "hash-abc123", []string{"read:routes"}, nil, ownerID)
	if err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
	if keyID == "" {
		t.Fatal("expected non-empty key ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAPIKey(ctx, keyID)
	if err != nil {
		t.Fatalf("GetAPIKey: %v", err)
	}
	if got.Name != "my-key" {
		t.Fatalf("expected name 'my-key', got %q", got.Name)
	}
	if len(got.Scopes) != 1 || got.Scopes[0] != "read:routes" {
		t.Fatalf("unexpected scopes: %v", got.Scopes)
	}
	_ = tx2.Rollback()

	// --- GetByHash ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byHash, err := tx3.GetAPIKeyByHash(ctx, "hash-abc123")
	if err != nil {
		t.Fatalf("GetAPIKeyByHash: %v", err)
	}
	if byHash.ID != keyID {
		t.Fatalf("GetAPIKeyByHash: expected id %q, got %q", keyID, byHash.ID)
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
	owned, err := tx4b.ListAPIKeysByOwner(ctx, ownerID)
	if err != nil {
		t.Fatalf("ListAPIKeysByOwner: %v", err)
	}
	if len(owned) != 1 {
		t.Fatalf("expected 1 owned key, got %d", len(owned))
	}
	_ = tx4b.Rollback()

	// --- Update (partial) ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newName := "renamed-key"
	updated, err := tx5.UpdateAPIKey(ctx, keyID, store.UpdateAPIKeyParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateAPIKey: %v", err)
	}
	if updated.Name != "renamed-key" {
		t.Fatalf("expected name 'renamed-key', got %q", updated.Name)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- RecordAPIKeyUse ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.RecordAPIKeyUse(ctx, keyID, time.Now()); err != nil {
		t.Fatalf("RecordAPIKeyUse: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Revoke ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.RevokeAPIKey(ctx, keyID); err != nil {
		t.Fatalf("RevokeAPIKey: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Revoked key should no longer appear in list.
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

func TestMySQL_User_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	email := "alice@example.com"
	disp := "Alice"
	u, err := tx1.CreateUser(ctx, &store.User{
		Username:     "Alice",
		Email:        &email,
		DisplayName:  &disp,
		PasswordHash: "hashed-pw",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if u.ID == "" {
		t.Fatal("expected non-empty user ID")
	}
	if u.Username != "alice" {
		t.Fatalf("expected lowercase username 'alice', got %q", u.Username)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	userID := u.ID

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetUser(ctx, userID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if got.Username != "alice" {
		t.Fatalf("GetUser: expected 'alice', got %q", got.Username)
	}
	_ = tx2.Rollback()

	// --- GetByUsername ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byName, err := tx3.GetUserByUsername(ctx, "ALICE")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if byName.ID != userID {
		t.Fatalf("GetUserByUsername: wrong ID %q", byName.ID)
	}
	_ = tx3.Rollback()

	// --- List ---
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

	// --- Update ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got.Status = "suspended"
	upd, err := tx5.UpdateUser(ctx, got)
	if err != nil {
		t.Fatalf("UpdateUser: %v", err)
	}
	if upd.Status != "suspended" {
		t.Fatalf("expected status 'suspended', got %q", upd.Status)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- IncrementFailedAttempts ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.IncrementFailedAttempts(ctx, userID, nil); err != nil {
		t.Fatalf("IncrementFailedAttempts: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	chk, _ := tx6b.GetUser(ctx, userID)
	if chk.FailedAttempts != 1 {
		t.Fatalf("expected FailedAttempts=1, got %d", chk.FailedAttempts)
	}
	_ = tx6b.Rollback()

	// --- ResetFailedAttempts ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.ResetFailedAttempts(ctx, userID); err != nil {
		t.Fatalf("ResetFailedAttempts: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx7b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	chk2, _ := tx7b.GetUser(ctx, userID)
	if chk2.FailedAttempts != 0 {
		t.Fatalf("expected FailedAttempts=0 after reset, got %d", chk2.FailedAttempts)
	}
	_ = tx7b.Rollback()

	// --- UpdateLastLogin ---
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx8.UpdateLastLogin(ctx, userID); err != nil {
		t.Fatalf("UpdateLastLogin: %v", err)
	}
	if err := tx8.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx8b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	chk3, _ := tx8b.GetUser(ctx, userID)
	if chk3.LastLogin == nil {
		t.Fatal("expected LastLogin to be set after UpdateLastLogin")
	}
	_ = tx8b.Rollback()

	// --- Delete ---
	tx9, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx9.DeleteUser(ctx, userID); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	if err := tx9.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

func TestMySQL_Session_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	userID := createTestUser(t, d, "session-user")

	now := time.Now().UTC()
	sess := &store.Session{
		ID:          fmt.Sprintf("sess-%s", userID[:8]),
		UserID:      userID,
		Fingerprint: "fp-abc",
		CreatedAt:   now,
		ExpiresAt:   now.Add(24 * time.Hour),
		LastActive:  now,
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	created, err := tx1.CreateSession(ctx, sess)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if created.ID != sess.ID {
		t.Fatalf("expected session id %q, got %q", sess.ID, created.ID)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetSession(ctx, sess.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.UserID != userID {
		t.Fatalf("GetSession: wrong UserID %q", got.UserID)
	}
	_ = tx2.Rollback()

	// --- ListByUser ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sessions, err := tx3.ListSessionsByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ListSessionsByUser: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	_ = tx3.Rollback()

	// --- UpdateLastActive ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newTime := now.Add(5 * time.Minute)
	if err := tx4.UpdateSessionLastActive(ctx, sess.ID, newTime); err != nil {
		t.Fatalf("UpdateSessionLastActive: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create a second session for DeleteByUserExcept test ---
	sess2 := &store.Session{
		ID:          fmt.Sprintf("sess2-%s", userID[:8]),
		UserID:      userID,
		Fingerprint: "fp-xyz",
		CreatedAt:   now,
		ExpiresAt:   now.Add(24 * time.Hour),
		LastActive:  now,
	}
	txS2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := txS2.CreateSession(ctx, sess2); err != nil {
		t.Fatalf("CreateSession (2): %v", err)
	}
	if err := txS2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- DeleteByUserExcept (keep sess, delete sess2) ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteSessionsByUserExcept(ctx, userID, sess.ID); err != nil {
		t.Fatalf("DeleteSessionsByUserExcept: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx5b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	sessions, err = tx5b.ListSessionsByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ListSessionsByUser after DeleteByUserExcept: %v", err)
	}
	if len(sessions) != 1 || sessions[0].ID != sess.ID {
		t.Fatalf("expected only sess to remain, got %d sessions", len(sessions))
	}
	_ = tx5b.Rollback()

	// --- DeleteExpiredSessions (none are actually expired) ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	n, err := tx6.DeleteExpiredSessions(ctx)
	if err != nil {
		t.Fatalf("DeleteExpiredSessions: %v", err)
	}
	_ = n
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DeleteSession(ctx, sess.ID); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- DeleteSessionsByUser (no-op, all already gone) ---
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx8.DeleteSessionsByUser(ctx, userID); err != nil {
		t.Fatalf("DeleteSessionsByUser: %v", err)
	}
	if err := tx8.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Config Versions
// ---------------------------------------------------------------------------

func TestMySQL_ConfigVersion_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// --- Save first version ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	v1, err := tx1.SaveConfigVersion(ctx, []byte(`{"key":"value1"}`), "admin")
	if err != nil {
		t.Fatalf("SaveConfigVersion: %v", err)
	}
	if v1 <= 0 {
		t.Fatalf("expected positive version, got %d", v1)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Save second version (must be greater) ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	v2, err := tx2.SaveConfigVersion(ctx, []byte(`{"key":"value2"}`), "admin")
	if err != nil {
		t.Fatalf("SaveConfigVersion (2): %v", err)
	}
	if v2 <= v1 {
		t.Fatalf("expected v2 > v1, got v1=%d v2=%d", v1, v2)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
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
	_ = tx3.Rollback()

	// --- List ---
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
	// Ordered DESC, so newest first.
	if versions[0].Version != v2 {
		t.Fatalf("expected first version=%d, got %d", v2, versions[0].Version)
	}
	_ = tx4.Rollback()

	// --- Latest ---
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

func TestMySQL_AuditLog(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// --- Append ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	entry := &riokuv1.AuditEntry{
		Actor:         "user-alice",
		EntityType:    "route",
		EntityId:      "route-123",
		Operation:     "create",
		Diff:          `{"before":null,"after":{}}`,
		ConfigVersion: 1,
		OccurredAt:    timestamppb.Now(),
	}
	if err := tx1.AppendAuditEntry(ctx, entry); err != nil {
		t.Fatalf("AppendAuditEntry: %v", err)
	}
	// Append a second entry with different actor.
	entry2 := &riokuv1.AuditEntry{
		Actor:      "user-bob",
		EntityType: "service",
		EntityId:   "svc-456",
		Operation:  "delete",
		OccurredAt: timestamppb.Now(),
	}
	if err := tx1.AppendAuditEntry(ctx, entry2); err != nil {
		t.Fatalf("AppendAuditEntry (2): %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Query (unfiltered) ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	entries, err := tx2.QueryAuditLog(ctx, store.AuditQuery{Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	_ = tx2.Rollback()

	// --- Query (filtered by actor) ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	filtered, err := tx3.QueryAuditLog(ctx, store.AuditQuery{Actor: "user-alice", Limit: 10})
	if err != nil {
		t.Fatalf("QueryAuditLog (filtered): %v", err)
	}
	if len(filtered) != 1 {
		t.Fatalf("expected 1 filtered entry, got %d", len(filtered))
	}
	if filtered[0].GetActor() != "user-alice" {
		t.Fatalf("expected actor 'user-alice', got %q", filtered[0].GetActor())
	}
	_ = tx3.Rollback()

	// --- Count ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	count, err := tx4.CountAuditLog(ctx, store.AuditQuery{})
	if err != nil {
		t.Fatalf("CountAuditLog: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected count=2, got %d", count)
	}
	_ = tx4.Rollback()

	// --- GetEntry ---
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	// Get the ID from the queried entries.
	allEntries, _ := tx5.QueryAuditLog(ctx, store.AuditQuery{Limit: 10})
	_ = tx5.Rollback()
	if len(allEntries) == 0 {
		t.Fatal("no entries to look up")
	}
	tx5b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	single, err := tx5b.GetAuditEntry(ctx, allEntries[0].GetId())
	if err != nil {
		t.Fatalf("GetAuditEntry: %v", err)
	}
	if single.GetId() != allEntries[0].GetId() {
		t.Fatal("GetAuditEntry returned wrong entry")
	}
	_ = tx5b.Rollback()

	// --- ListAuditActors ---
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	actors, err := tx6.ListAuditActors(ctx, "", 10)
	if err != nil {
		t.Fatalf("ListAuditActors: %v", err)
	}
	if len(actors) != 2 {
		t.Fatalf("expected 2 actors, got %d", len(actors))
	}
	_ = tx6.Rollback()

	// --- ListAuditResourceIDs ---
	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	resIDs, err := tx7.ListAuditResourceIDs(ctx, "route", "", 10)
	if err != nil {
		t.Fatalf("ListAuditResourceIDs: %v", err)
	}
	if len(resIDs) != 1 || resIDs[0] != "route-123" {
		t.Fatalf("expected [route-123], got %v", resIDs)
	}
	_ = tx7.Rollback()
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

func TestMySQL_Role_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	role, err := tx1.CreateRole(ctx, store.CreateRoleParams{
		ID:          "role-test-1",
		Name:        "Test Role",
		Description: "A test role",
		Permissions: []string{},
	})
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}
	if role.ID != "role-test-1" {
		t.Fatalf("expected id 'role-test-1', got %q", role.ID)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetRole(ctx, "role-test-1")
	if err != nil {
		t.Fatalf("GetRole: %v", err)
	}
	if got.Name != "Test Role" {
		t.Fatalf("expected name 'Test Role', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- ErrRoleNotFound ---
	tx2b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx2b.GetRole(ctx, "nonexistent-role")
	if err != store.ErrRoleNotFound {
		t.Fatalf("expected ErrRoleNotFound, got %v", err)
	}
	_ = tx2b.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	roles, err := tx3.ListRoles(ctx)
	if err != nil {
		t.Fatalf("ListRoles: %v", err)
	}
	// At minimum our created role should be present (plus any seeded global roles).
	found := false
	for _, r := range roles {
		if r.ID == "role-test-1" {
			found = true
		}
	}
	if !found {
		t.Fatal("created role not found in ListRoles")
	}
	_ = tx3.Rollback()

	// --- Update (add/remove perms) ---
	// First we need a real permission ID — list them and pick one.
	txP, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	perms, err := txP.ListPermissions(ctx)
	if err != nil {
		t.Fatalf("ListPermissions: %v", err)
	}
	_ = txP.Rollback()

	if len(perms) > 0 {
		permID := perms[0].ID

		tx4, err := d.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("Begin: %v", err)
		}
		newName := "Updated Role"
		updRole, err := tx4.UpdateRole(ctx, "role-test-1", store.UpdateRoleParams{
			Name:     &newName,
			AddPerms: []string{permID},
		})
		if err != nil {
			t.Fatalf("UpdateRole: %v", err)
		}
		if updRole.Name != "Updated Role" {
			t.Fatalf("expected name 'Updated Role', got %q", updRole.Name)
		}
		if len(updRole.Permissions) != 1 {
			t.Fatalf("expected 1 permission after add, got %d", len(updRole.Permissions))
		}
		if err := tx4.Commit(); err != nil {
			t.Fatalf("Commit: %v", err)
		}

		// Remove the permission.
		tx4b, err := d.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("Begin: %v", err)
		}
		updRole2, err := tx4b.UpdateRole(ctx, "role-test-1", store.UpdateRoleParams{
			RemovePerms: []string{permID},
		})
		if err != nil {
			t.Fatalf("UpdateRole (remove perm): %v", err)
		}
		if len(updRole2.Permissions) != 0 {
			t.Fatalf("expected 0 permissions after remove, got %d", len(updRole2.Permissions))
		}
		if err := tx4b.Commit(); err != nil {
			t.Fatalf("Commit: %v", err)
		}
	}

	// --- ErrRoleImmutable on role_superadmin ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx5.UpdateRole(ctx, "role_superadmin", store.UpdateRoleParams{})
	if err != store.ErrRoleImmutable {
		t.Fatalf("expected ErrRoleImmutable for UpdateRole, got %v", err)
	}
	_ = tx5.Rollback()

	tx5b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5b.DeleteRole(ctx, "role_superadmin"); err != store.ErrRoleImmutable {
		t.Fatalf("expected ErrRoleImmutable for DeleteRole, got %v", err)
	}
	_ = tx5b.Rollback()

	// --- Delete ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteRole(ctx, "role-test-1"); err != nil {
		t.Fatalf("DeleteRole: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrRoleNotFound after delete ---
	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DeleteRole(ctx, "role-test-1"); err != store.ErrRoleNotFound {
		t.Fatalf("expected ErrRoleNotFound after delete, got %v", err)
	}
	_ = tx7.Rollback()
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

func TestMySQL_Permissions_List(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	perms, err := tx1.ListPermissions(ctx)
	if err != nil {
		t.Fatalf("ListPermissions: %v", err)
	}
	// Permissions are seeded by the migration; there should be at least some.
	// We don't assert a specific count — just that the call succeeds and
	// wildcard entries are excluded.
	for _, p := range perms {
		if p.ID == "*" {
			t.Fatal("wildcard permission '*' should be excluded")
		}
		if len(p.ID) > 2 && p.ID[len(p.ID)-2:] == ":*" {
			t.Fatalf("resource wildcard %q should be excluded", p.ID)
		}
	}
	_ = tx1.Rollback()
}

// ---------------------------------------------------------------------------
// User Roles + Scopes
// ---------------------------------------------------------------------------

func TestMySQL_UserRoles(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	userID := createTestUser(t, d, "userrole-user")

	// Create a role to assign.
	txR, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := txR.CreateRole(ctx, store.CreateRoleParams{
		ID:   "role-for-assign",
		Name: "Assignable Role",
	}); err != nil {
		t.Fatalf("CreateRole: %v", err)
	}
	if err := txR.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- AssignRole ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx1.AssignRole(ctx, userID, "role-for-assign", "admin"); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Idempotent second assign ---
	tx1b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx1b.AssignRole(ctx, userID, "role-for-assign", "admin"); err != nil {
		t.Fatalf("AssignRole (idempotent): %v", err)
	}
	if err := tx1b.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
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
	if userRoles[0].RoleID != "role-for-assign" {
		t.Fatalf("expected RoleID 'role-for-assign', got %q", userRoles[0].RoleID)
	}
	_ = tx2.Rollback()

	// --- ListUsersWithRole ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	usersWithRole, err := tx3.ListUsersWithRole(ctx, "role-for-assign")
	if err != nil {
		t.Fatalf("ListUsersWithRole: %v", err)
	}
	if len(usersWithRole) != 1 || usersWithRole[0] != userID {
		t.Fatalf("expected [%s], got %v", userID, usersWithRole)
	}
	_ = tx3.Rollback()

	// --- RevokeRole ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.RevokeRole(ctx, userID, "role-for-assign"); err != nil {
		t.Fatalf("RevokeRole: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx4b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	userRoles, err = tx4b.ListUserRoles(ctx, userID)
	if err != nil {
		t.Fatalf("ListUserRoles after revoke: %v", err)
	}
	if len(userRoles) != 0 {
		t.Fatalf("expected 0 roles after revoke, got %d", len(userRoles))
	}
	_ = tx4b.Rollback()
}

func TestMySQL_GetUserScopes(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	userID := createTestUser(t, d, "scope-user")

	// Fetch real permission IDs from migrations.
	txP, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	allPerms, err := txP.ListPermissions(ctx)
	if err != nil {
		t.Fatalf("ListPermissions: %v", err)
	}
	_ = txP.Rollback()

	if len(allPerms) < 2 {
		t.Skip("need at least 2 permissions seeded by migration")
	}

	perm1 := allPerms[0].ID
	perm2 := allPerms[1].ID

	// Create two roles with one permission each.
	txR, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := txR.CreateRole(ctx, store.CreateRoleParams{
		ID: "scope-role-a", Name: "Scope Role A", Permissions: []string{perm1},
	}); err != nil {
		t.Fatalf("CreateRole A: %v", err)
	}
	if _, err := txR.CreateRole(ctx, store.CreateRoleParams{
		ID: "scope-role-b", Name: "Scope Role B", Permissions: []string{perm2},
	}); err != nil {
		t.Fatalf("CreateRole B: %v", err)
	}
	if err := txR.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Assign both roles.
	txA, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := txA.AssignRole(ctx, userID, "scope-role-a", ""); err != nil {
		t.Fatalf("AssignRole A: %v", err)
	}
	if err := txA.AssignRole(ctx, userID, "scope-role-b", ""); err != nil {
		t.Fatalf("AssignRole B: %v", err)
	}
	if err := txA.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// GetUserScopes should return 2 distinct permissions.
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	scopes, err := tx1.GetUserScopes(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserScopes: %v", err)
	}
	if len(scopes) != 2 {
		t.Fatalf("expected 2 scopes, got %d: %v", len(scopes), scopes)
	}
	_ = tx1.Rollback()
}

// ---------------------------------------------------------------------------
// TOTP Backup Codes
// ---------------------------------------------------------------------------

func TestMySQL_TOTPBackupCodes(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	userID := createTestUser(t, d, "totp-user")

	// --- Create (first batch) ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	codes1 := []string{"hash1", "hash2", "hash3"}
	if err := tx1.CreateTOTPBackupCodes(ctx, userID, codes1); err != nil {
		t.Fatalf("CreateTOTPBackupCodes: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create (second batch, should replace first) ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	codes2 := []string{"hash4", "hash5"}
	if err := tx2.CreateTOTPBackupCodes(ctx, userID, codes2); err != nil {
		t.Fatalf("CreateTOTPBackupCodes (replace): %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ListUnused (should only see 2, not 5) ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	unused, err := tx3.ListUnusedTOTPBackupCodes(ctx, userID)
	if err != nil {
		t.Fatalf("ListUnusedTOTPBackupCodes: %v", err)
	}
	if len(unused) != 2 {
		t.Fatalf("expected 2 unused codes (from second batch), got %d", len(unused))
	}
	_ = tx3.Rollback()

	// --- MarkUsed ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tx4b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	// Re-fetch unused list inside our write tx to get ID.
	unusedInTx, _ := tx4b.ListUnusedTOTPBackupCodes(ctx, userID)
	_ = tx4b.Rollback()

	if len(unusedInTx) == 0 {
		t.Fatal("no codes to mark used")
	}
	if err := tx4.MarkTOTPBackupCodeUsed(ctx, unusedInTx[0].ID); err != nil {
		t.Fatalf("MarkTOTPBackupCodeUsed: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Should now have 1 unused code.
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	unused2, _ := tx5.ListUnusedTOTPBackupCodes(ctx, userID)
	if len(unused2) != 1 {
		t.Fatalf("expected 1 unused code after mark, got %d", len(unused2))
	}
	_ = tx5.Rollback()

	// --- Delete ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteTOTPBackupCodes(ctx, userID); err != nil {
		t.Fatalf("DeleteTOTPBackupCodes: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	unused3, _ := tx7.ListUnusedTOTPBackupCodes(ctx, userID)
	if len(unused3) != 0 {
		t.Fatalf("expected 0 codes after delete, got %d", len(unused3))
	}
	_ = tx7.Rollback()
}
