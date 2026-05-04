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

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

func TestMySQL_Tenant_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
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
		t.Fatal("expected non-empty tenant ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetTenant(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if got.Slug != "acme" {
		t.Fatalf("expected slug 'acme', got %q", got.Slug)
	}
	_ = tx2.Rollback()

	// --- GetBySlug ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	bySlug, err := tx3.GetTenantBySlug(ctx, "acme")
	if err != nil {
		t.Fatalf("GetTenantBySlug: %v", err)
	}
	if bySlug.ID != created.ID {
		t.Fatalf("ID mismatch: expected %s, got %s", created.ID, bySlug.ID)
	}
	_ = tx3.Rollback()

	// --- List ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx4.ListTenants(ctx)
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one tenant")
	}
	_ = tx4.Rollback()

	// --- Update ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newName := "Acme Updated"
	updated, err := tx5.UpdateTenant(ctx, created.ID, store.UpdateTenantParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateTenant: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, updated.Name)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrTenantSlugTaken ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx6.CreateTenant(ctx, &store.Tenant{Slug: "acme", Name: "Dup"})
	if err != store.ErrTenantSlugTaken {
		t.Fatalf("expected ErrTenantSlugTaken, got %v", err)
	}
	_ = tx6.Rollback()

	// --- ErrTenantImmutable (default tenant) ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DeleteTenant(ctx, "tenant_default"); err != store.ErrTenantImmutable {
		t.Fatalf("expected ErrTenantImmutable, got %v", err)
	}
	_ = tx7.Rollback()

	// --- Delete ---
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx8.DeleteTenant(ctx, created.ID); err != nil {
		t.Fatalf("DeleteTenant: %v", err)
	}
	if err := tx8.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Confirm gone.
	tx9, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx9.GetTenant(ctx, created.ID); err != store.ErrTenantNotFound {
		t.Fatalf("expected ErrTenantNotFound after delete, got %v", err)
	}
	_ = tx9.Rollback()
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

func TestMySQL_Membership_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	userID := createTestUser(t, d, "membership-user")

	// Need a tenant.
	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "mbr-tenant", Name: "Mbr Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	m, err := tx1.CreateMembership(ctx, &store.Membership{
		TenantID: tenant.ID,
		UserID:   userID,
		State:    "pending",
	})
	if err != nil {
		t.Fatalf("CreateMembership: %v", err)
	}
	if m.ID == "" {
		t.Fatal("expected non-empty membership ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetMembership(ctx, m.ID)
	if err != nil {
		t.Fatalf("GetMembership: %v", err)
	}
	if got.State != "pending" {
		t.Fatalf("expected state 'pending', got %q", got.State)
	}
	_ = tx2.Rollback()

	// --- GetByTenantUser ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byTU, err := tx3.GetMembershipByTenantUser(ctx, tenant.ID, userID)
	if err != nil {
		t.Fatalf("GetMembershipByTenantUser: %v", err)
	}
	if byTU.ID != m.ID {
		t.Fatalf("ID mismatch: %s != %s", byTU.ID, m.ID)
	}
	_ = tx3.Rollback()

	// --- ListByTenant ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx4.ListMembershipsByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListMembershipsByTenant: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 membership, got %d", len(list))
	}
	_ = tx4.Rollback()

	// --- ListByUser ---
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byUser, err := tx5.ListMembershipsByUser(ctx, userID)
	if err != nil {
		t.Fatalf("ListMembershipsByUser: %v", err)
	}
	if len(byUser) != 1 {
		t.Fatalf("expected 1 membership by user, got %d", len(byUser))
	}
	_ = tx5.Rollback()

	// --- UpdateState (pending -> active) ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	activated, err := tx6.UpdateMembershipState(ctx, m.ID, "active")
	if err != nil {
		t.Fatalf("UpdateMembershipState: %v", err)
	}
	if activated.State != "active" {
		t.Fatalf("expected state 'active', got %q", activated.State)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Invalid transition (active -> pending) ---
	tx6b, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6b.UpdateMembershipState(ctx, m.ID, "pending"); err != store.ErrMembershipInvalidState {
		t.Fatalf("expected ErrMembershipInvalidState, got %v", err)
	}
	_ = tx6b.Rollback()

	// --- ErrMembershipExists on dup ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx7.CreateMembership(ctx, &store.Membership{TenantID: tenant.ID, UserID: userID})
	if err != store.ErrMembershipExists {
		t.Fatalf("expected ErrMembershipExists, got %v", err)
	}
	_ = tx7.Rollback()

	// --- Delete ---
	tx8, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx8.DeleteMembership(ctx, m.ID); err != nil {
		t.Fatalf("DeleteMembership: %v", err)
	}
	if err := tx8.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Membership Roles
// ---------------------------------------------------------------------------

func TestMySQL_MembershipRoles(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	userID := createTestUser(t, d, "mbrole-user")

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "mbrole-tenant", Name: "MbRole Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txM, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	m, err := txM.CreateMembership(ctx, &store.Membership{
		TenantID: tenant.ID,
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("CreateMembership: %v", err)
	}
	if err := txM.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Assign ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx1.AssignMembershipRole(ctx, m.ID, "role_viewer", ""); err != nil {
		t.Fatalf("AssignMembershipRole: %v", err)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- List ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	roles, err := tx2.ListMembershipRoles(ctx, m.ID)
	if err != nil {
		t.Fatalf("ListMembershipRoles: %v", err)
	}
	if len(roles) != 1 {
		t.Fatalf("expected 1 role, got %d", len(roles))
	}
	if roles[0].ID != "role_viewer" {
		t.Fatalf("expected role_viewer, got %s", roles[0].ID)
	}
	_ = tx2.Rollback()

	// --- Assign-twice idempotent ---
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx3.AssignMembershipRole(ctx, m.ID, "role_viewer", ""); err != nil {
		t.Fatalf("AssignMembershipRole (idempotent): %v", err)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Still 1 role.
	tx3b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	roles2, _ := tx3b.ListMembershipRoles(ctx, m.ID)
	if len(roles2) != 1 {
		t.Fatalf("expected 1 role after idempotent assign, got %d", len(roles2))
	}
	_ = tx3b.Rollback()

	// --- Revoke ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.RevokeMembershipRole(ctx, m.ID, "role_viewer"); err != nil {
		t.Fatalf("RevokeMembershipRole: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	roles3, _ := tx5.ListMembershipRoles(ctx, m.ID)
	if len(roles3) != 0 {
		t.Fatalf("expected 0 roles after revoke, got %d", len(roles3))
	}
	_ = tx5.Rollback()
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

func TestMySQL_Site_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "site-tenant", Name: "Site Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	site, err := tx1.CreateSite(ctx, &store.Site{
		TenantID: tenant.ID,
		Name:     "My Site",
		Domain:   "mysite.example.com",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateSite: %v", err)
	}
	if site.ID == "" {
		t.Fatal("expected non-empty site ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetSite(ctx, tenant.ID, site.ID)
	if err != nil {
		t.Fatalf("GetSite: %v", err)
	}
	if got.Domain != "mysite.example.com" {
		t.Fatalf("expected domain 'mysite.example.com', got %q", got.Domain)
	}
	_ = tx2.Rollback()

	// --- ListByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListSitesByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListSitesByTenant: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 site, got %d", len(list))
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newDomain := "updated.example.com"
	updated, err := tx4.UpdateSite(ctx, tenant.ID, site.ID, store.UpdateSiteParams{Domain: &newDomain})
	if err != nil {
		t.Fatalf("UpdateSite: %v", err)
	}
	if updated.Domain != newDomain {
		t.Fatalf("expected domain %q, got %q", newDomain, updated.Domain)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Toggle ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	toggled, err := tx5.ToggleSite(ctx, tenant.ID, site.ID, false)
	if err != nil {
		t.Fatalf("ToggleSite: %v", err)
	}
	if toggled.Enabled {
		t.Fatal("expected site to be disabled")
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrSiteDomainTaken ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx6.CreateSite(ctx, &store.Site{
		TenantID: tenant.ID,
		Name:     "Dup",
		Domain:   "updated.example.com",
	})
	if err != store.ErrSiteDomainTaken {
		t.Fatalf("expected ErrSiteDomainTaken, got %v", err)
	}
	_ = tx6.Rollback()

	// --- Delete ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DeleteSite(ctx, tenant.ID, site.ID); err != nil {
		t.Fatalf("DeleteSite: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx8, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx8.GetSite(ctx, tenant.ID, site.ID); err != store.ErrSiteNotFound {
		t.Fatalf("expected ErrSiteNotFound after delete, got %v", err)
	}
	_ = tx8.Rollback()
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

func TestMySQL_Middleware_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "mw-tenant", Name: "MW Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	mw, err := tx1.CreateMiddleware(ctx, &store.Middleware{
		TenantID: tenant.ID,
		Name:     "my-middleware",
		Kind:     "rate-limit",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateMiddleware: %v", err)
	}
	if mw.ID == "" {
		t.Fatal("expected non-empty middleware ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetMiddleware(ctx, tenant.ID, mw.ID)
	if err != nil {
		t.Fatalf("GetMiddleware: %v", err)
	}
	if got.Kind != "rate-limit" {
		t.Fatalf("expected kind 'rate-limit', got %q", got.Kind)
	}
	_ = tx2.Rollback()

	// --- ListByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListMiddlewaresByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListMiddlewaresByTenant: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 middleware, got %d", len(list))
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newName := "my-middleware-v2"
	updated, err := tx4.UpdateMiddleware(ctx, tenant.ID, mw.ID, store.UpdateMiddlewareParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateMiddleware: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, updated.Name)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ErrMiddlewareNameTaken ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx5.CreateMiddleware(ctx, &store.Middleware{
		TenantID: tenant.ID,
		Name:     "my-middleware-v2",
		Kind:     "cors",
	})
	if err != store.ErrMiddlewareNameTaken {
		t.Fatalf("expected ErrMiddlewareNameTaken, got %v", err)
	}
	_ = tx5.Rollback()

	// --- Delete ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteMiddleware(ctx, tenant.ID, mw.ID); err != nil {
		t.Fatalf("DeleteMiddleware: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx7.GetMiddleware(ctx, tenant.ID, mw.ID); err != store.ErrMiddlewareNotFound {
		t.Fatalf("expected ErrMiddlewareNotFound after delete, got %v", err)
	}
	_ = tx7.Rollback()
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

func TestMySQL_Dashboard_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "dash-tenant", Name: "Dash Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	dash, err := tx1.CreateDashboard(ctx, &store.Dashboard{
		TenantID: tenant.ID,
		Name:     "Main Dashboard",
	})
	if err != nil {
		t.Fatalf("CreateDashboard: %v", err)
	}
	if dash.ID == "" {
		t.Fatal("expected non-empty dashboard ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetDashboard(ctx, tenant.ID, dash.ID)
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	if got.Name != "Main Dashboard" {
		t.Fatalf("expected name 'Main Dashboard', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListDashboardsByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListDashboardsByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one dashboard")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newDashName := "Renamed Dashboard"
	updatedDash, err := tx4.UpdateDashboard(ctx, tenant.ID, dash.ID, store.UpdateDashboardParams{Name: &newDashName})
	if err != nil {
		t.Fatalf("UpdateDashboard: %v", err)
	}
	if updatedDash.Name != newDashName {
		t.Fatalf("expected name %q, got %q", newDashName, updatedDash.Name)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- SetDefault ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	defaulted, err := tx5.SetDefaultDashboard(ctx, tenant.ID, dash.ID)
	if err != nil {
		t.Fatalf("SetDefaultDashboard: %v", err)
	}
	if !defaulted.IsDefault {
		t.Fatal("expected IsDefault=true")
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- SetDashboardHomeForUser ---
	ownerID := createTestUser(t, d, "dash-owner")
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	homed, err := tx6.SetDashboardHomeForUser(ctx, tenant.ID, dash.ID, ownerID)
	if err != nil {
		t.Fatalf("SetDashboardHomeForUser: %v", err)
	}
	if homed.ID != dash.ID {
		t.Fatalf("expected dashboard ID %s, got %s", dash.ID, homed.ID)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.DeleteDashboard(ctx, tenant.ID, dash.ID); err != nil {
		t.Fatalf("DeleteDashboard: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx8, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx8.GetDashboard(ctx, tenant.ID, dash.ID); err != store.ErrDashboardNotFound {
		t.Fatalf("expected ErrDashboardNotFound after delete, got %v", err)
	}
	_ = tx8.Rollback()
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

func TestMySQL_Widget_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "widget-tenant", Name: "Widget Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txD, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	dash, err := txD.CreateDashboard(ctx, &store.Dashboard{
		TenantID: tenant.ID,
		Name:     "Widget Board",
	})
	if err != nil {
		t.Fatalf("CreateDashboard: %v", err)
	}
	if err := txD.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	w, err := tx1.CreateWidget(ctx, &store.Widget{
		DashboardID: dash.ID,
		Kind:        "chart",
		Title:       "Revenue Chart",
	})
	if err != nil {
		t.Fatalf("CreateWidget: %v", err)
	}
	if w.ID == "" {
		t.Fatal("expected non-empty widget ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetWidget(ctx, w.ID)
	if err != nil {
		t.Fatalf("GetWidget: %v", err)
	}
	if got.Kind != "chart" {
		t.Fatalf("expected kind 'chart', got %q", got.Kind)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	wlist, err := tx3.ListWidgetsByDashboard(ctx, dash.ID)
	if err != nil {
		t.Fatalf("ListWidgetsByDashboard: %v", err)
	}
	if len(wlist) != 1 {
		t.Fatalf("expected 1 widget, got %d", len(wlist))
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newTitle := "Updated Chart"
	updatedW, err := tx4.UpdateWidget(ctx, w.ID, store.UpdateWidgetParams{Title: &newTitle})
	if err != nil {
		t.Fatalf("UpdateWidget: %v", err)
	}
	if updatedW.Title != newTitle {
		t.Fatalf("expected title %q, got %q", newTitle, updatedW.Title)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- UpdateDashboardLayout ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	layout := `{"x":1,"y":2,"w":6,"h":4}`
	if err := tx5.UpdateDashboardLayout(ctx, dash.ID, map[string]string{w.ID: layout}); err != nil {
		t.Fatalf("UpdateDashboardLayout: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteWidget(ctx, dash.ID, w.ID); err != nil {
		t.Fatalf("DeleteWidget: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx7.GetWidget(ctx, w.ID); err != store.ErrWidgetNotFound {
		t.Fatalf("expected ErrWidgetNotFound after delete, got %v", err)
	}
	_ = tx7.Rollback()
}

// ---------------------------------------------------------------------------
// Dashboard Versions
// ---------------------------------------------------------------------------

func TestMySQL_DashboardVersion(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "ver-tenant", Name: "Ver Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txD, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	dash, err := txD.CreateDashboard(ctx, &store.Dashboard{
		TenantID: tenant.ID,
		Name:     "Versioned Board",
	})
	if err != nil {
		t.Fatalf("CreateDashboard: %v", err)
	}
	if err := txD.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create v1 ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	v1, err := tx1.CreateDashboardVersion(ctx, &store.DashboardVersion{
		DashboardID:  dash.ID,
		SnapshotJSON: `{"widgets":[]}`,
		Note:         "initial",
	})
	if err != nil {
		t.Fatalf("CreateDashboardVersion v1: %v", err)
	}
	if v1.Version != 1 {
		t.Fatalf("expected version 1, got %d", v1.Version)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create v2 ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	v2, err := tx2.CreateDashboardVersion(ctx, &store.DashboardVersion{
		DashboardID:  dash.ID,
		SnapshotJSON: `{"widgets":["a"]}`,
		Note:         "added widget",
	})
	if err != nil {
		t.Fatalf("CreateDashboardVersion v2: %v", err)
	}
	if v2.Version != 2 {
		t.Fatalf("expected version 2, got %d", v2.Version)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	gotV, err := tx3.GetDashboardVersion(ctx, v1.ID)
	if err != nil {
		t.Fatalf("GetDashboardVersion: %v", err)
	}
	if gotV.Note != "initial" {
		t.Fatalf("expected note 'initial', got %q", gotV.Note)
	}
	_ = tx3.Rollback()

	// --- List (should be ordered DESC by version) ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	versions, err := tx4.ListDashboardVersions(ctx, dash.ID)
	if err != nil {
		t.Fatalf("ListDashboardVersions: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("expected 2 versions, got %d", len(versions))
	}
	if versions[0].Version != 2 {
		t.Fatalf("expected first version to be 2 (DESC), got %d", versions[0].Version)
	}
	_ = tx4.Rollback()
}

// ---------------------------------------------------------------------------
// Dashboard Shares
// ---------------------------------------------------------------------------

func TestMySQL_DashboardShare_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "share-tenant", Name: "Share Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	txD, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	dash, err := txD.CreateDashboard(ctx, &store.Dashboard{
		TenantID: tenant.ID,
		Name:     "Shared Board",
	})
	if err != nil {
		t.Fatalf("CreateDashboard: %v", err)
	}
	if err := txD.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tenantCtx := store.WithTenantID(ctx, tenant.ID)

	// --- Create ---
	tx1, err := d.Begin(tenantCtx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	share, err := tx1.CreateDashboardShare(tenantCtx, &store.DashboardShare{
		DashboardID: dash.ID,
		RoleID:      "role_viewer",
	})
	if err != nil {
		t.Fatalf("CreateDashboardShare: %v", err)
	}
	if share.ID == "" {
		t.Fatal("expected non-empty share ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- List ---
	tx2, err := d.Begin(tenantCtx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	shares, err := tx2.ListDashboardShares(tenantCtx, dash.ID)
	if err != nil {
		t.Fatalf("ListDashboardShares: %v", err)
	}
	if len(shares) != 1 {
		t.Fatalf("expected 1 share, got %d", len(shares))
	}
	if shares[0].RoleID != "role_viewer" {
		t.Fatalf("expected role_viewer, got %s", shares[0].RoleID)
	}
	_ = tx2.Rollback()

	// --- Delete ---
	tx3, err := d.Begin(tenantCtx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx3.DeleteDashboardShare(tenantCtx, share.ID); err != nil {
		t.Fatalf("DeleteDashboardShare: %v", err)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx4, err := d.Begin(tenantCtx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	empty, err := tx4.ListDashboardShares(tenantCtx, dash.ID)
	if err != nil {
		t.Fatalf("ListDashboardShares after delete: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("expected 0 shares after delete, got %d", len(empty))
	}
	_ = tx4.Rollback()
}

// ---------------------------------------------------------------------------
// Access Policies
// ---------------------------------------------------------------------------

func TestMySQL_AccessPolicy_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "ap-tenant", Name: "AP Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tenantCtx := store.WithTenantID(ctx, tenant.ID)

	// --- Create ---
	tx1, err := d.Begin(tenantCtx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ap, err := tx1.CreateAccessPolicy(tenantCtx, &store.AccessPolicy{
		Name:       "test-policy",
		Effect:     store.AccessPolicyEffect("allow"),
		TargetType: store.AccessPolicyTargetType("route"),
		Priority:   10,
		Enabled:    true,
	})
	if err != nil {
		t.Fatalf("CreateAccessPolicy: %v", err)
	}
	if ap.ID == "" {
		t.Fatal("expected non-empty policy ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(tenantCtx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAccessPolicy(tenantCtx, ap.ID)
	if err != nil {
		t.Fatalf("GetAccessPolicy: %v", err)
	}
	if got.Priority != 10 {
		t.Fatalf("expected priority 10, got %d", got.Priority)
	}
	if !got.Enabled {
		t.Fatal("expected policy to be enabled")
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(tenantCtx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	apList, err := tx3.ListAccessPolicies(tenantCtx)
	if err != nil {
		t.Fatalf("ListAccessPolicies: %v", err)
	}
	if len(apList) != 1 {
		t.Fatalf("expected 1 policy, got %d", len(apList))
	}
	_ = tx3.Rollback()

	// --- Update each field ---
	tx4, err := d.Begin(tenantCtx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newAPName := "renamed-policy"
	newPriority := 20
	newEnabled := false
	updatedAP, err := tx4.UpdateAccessPolicy(tenantCtx, ap.ID, store.UpdateAccessPolicyParams{
		Name:     &newAPName,
		Priority: &newPriority,
		Enabled:  &newEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateAccessPolicy: %v", err)
	}
	if updatedAP.Name != newAPName {
		t.Fatalf("expected name %q, got %q", newAPName, updatedAP.Name)
	}
	if updatedAP.Priority != newPriority {
		t.Fatalf("expected priority %d, got %d", newPriority, updatedAP.Priority)
	}
	if updatedAP.Enabled {
		t.Fatal("expected policy to be disabled after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(tenantCtx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAccessPolicy(tenantCtx, ap.ID); err != nil {
		t.Fatalf("DeleteAccessPolicy: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(tenantCtx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetAccessPolicy(tenantCtx, ap.ID); err != store.ErrAccessPolicyNotFound {
		t.Fatalf("expected ErrAccessPolicyNotFound after delete, got %v", err)
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// RBAC Policies
// ---------------------------------------------------------------------------

func TestMySQL_RbacPolicy_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "rp-tenant", Name: "RP Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tenantCtx := store.WithTenantID(ctx, tenant.ID)

	// --- Create ---
	tx1, err := d.Begin(tenantCtx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	rp, err := tx1.CreateRbacPolicy(tenantCtx, &store.RbacPolicy{
		Name:        "test-rbac",
		SubjectType: "user",
		SubjectID:   "some-user",
		RoleID:      "role_admin",
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("CreateRbacPolicy: %v", err)
	}
	if rp.ID == "" {
		t.Fatal("expected non-empty rbac policy ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(tenantCtx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	gotRP, err := tx2.GetRbacPolicy(tenantCtx, rp.ID)
	if err != nil {
		t.Fatalf("GetRbacPolicy: %v", err)
	}
	if gotRP.RoleID != "role_admin" {
		t.Fatalf("expected role_admin, got %s", gotRP.RoleID)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(tenantCtx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	rpList, err := tx3.ListRbacPolicies(tenantCtx)
	if err != nil {
		t.Fatalf("ListRbacPolicies: %v", err)
	}
	if len(rpList) != 1 {
		t.Fatalf("expected 1 rbac policy, got %d", len(rpList))
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(tenantCtx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newRPDesc := "updated description"
	newRPEnabled := false
	updatedRP, err := tx4.UpdateRbacPolicy(tenantCtx, rp.ID, store.UpdateRbacPolicyParams{
		Description: &newRPDesc,
		Enabled:     &newRPEnabled,
	})
	if err != nil {
		t.Fatalf("UpdateRbacPolicy: %v", err)
	}
	if updatedRP.Description != newRPDesc {
		t.Fatalf("expected description %q, got %q", newRPDesc, updatedRP.Description)
	}
	if updatedRP.Enabled {
		t.Fatal("expected policy to be disabled after update")
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(tenantCtx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteRbacPolicy(tenantCtx, rp.ID); err != nil {
		t.Fatalf("DeleteRbacPolicy: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(tenantCtx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetRbacPolicy(tenantCtx, rp.ID); err != store.ErrRbacPolicyNotFound {
		t.Fatalf("expected ErrRbacPolicyNotFound after delete, got %v", err)
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// AI subsystem tests
// ---------------------------------------------------------------------------

func TestMySQL_AIProvider_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// Pre-create tenant.
	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "ai-prov-tenant", Name: "AI Provider Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	enabled := true
	prov, err := tx1.CreateAIProvider(ctx, &store.AIProvider{
		TenantID: tenant.ID,
		Name:     "openai-main",
		Kind:     "openai",
		BaseURL:  "https://api.openai.com",
		Enabled:  enabled,
		Metadata: `{"region":"us"}`,
	})
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	if prov.ID == "" {
		t.Fatal("expected non-empty provider ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAIProvider(ctx, tenant.ID, prov.ID)
	if err != nil {
		t.Fatalf("GetAIProvider: %v", err)
	}
	if got.Name != "openai-main" {
		t.Fatalf("expected name 'openai-main', got %q", got.Name)
	}
	if !got.Enabled {
		t.Fatal("expected provider to be enabled")
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListAIProvidersByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListAIProvidersByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one provider")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newName := "openai-updated"
	updated, err := tx4.UpdateAIProvider(ctx, tenant.ID, prov.ID, store.UpdateAIProviderParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateAIProvider: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, updated.Name)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAIProvider(ctx, tenant.ID, prov.ID); err != nil {
		t.Fatalf("DeleteAIProvider: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetAIProvider(ctx, tenant.ID, prov.ID); err != store.ErrAIProviderNotFound {
		t.Fatalf("expected ErrAIProviderNotFound after delete, got %v", err)
	}
	_ = tx6.Rollback()
}

func TestMySQL_ProviderModel_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// Pre-create tenant + provider (FK dependency).
	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "ai-model-tenant", Name: "AI Model Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	prov, err := txT.CreateAIProvider(ctx, &store.AIProvider{
		TenantID: tenant.ID,
		Name:     "openai-for-models",
		Kind:     "openai",
		BaseURL:  "https://api.openai.com",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Add ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	model, err := tx1.AddProviderModel(ctx, &store.AIProviderModel{
		ProviderID:       prov.ID,
		UpstreamModelID:  "gpt-4o",
		Alias:            "gpt4o",
		RateLimitRPM:     60,
		DailyQuotaTokens: 1000000,
		Enabled:          true,
	})
	if err != nil {
		t.Fatalf("AddProviderModel: %v", err)
	}
	if model.ID == "" {
		t.Fatal("expected non-empty model ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- List ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx2.ListProviderModels(ctx, prov.ID)
	if err != nil {
		t.Fatalf("ListProviderModels: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one model")
	}
	_ = tx2.Rollback()

	// --- Update ---
	tx3, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newAlias := "gpt4o-v2"
	updated, err := tx3.UpdateProviderModel(ctx, prov.ID, model.ID, store.UpdateAIProviderModelParams{Alias: &newAlias})
	if err != nil {
		t.Fatalf("UpdateProviderModel: %v", err)
	}
	if updated.Alias != newAlias {
		t.Fatalf("expected alias %q, got %q", newAlias, updated.Alias)
	}
	if err := tx3.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Remove ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.RemoveProviderModel(ctx, prov.ID, model.ID); err != nil {
		t.Fatalf("RemoveProviderModel: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

func TestMySQL_MCPServer_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "mcp-tenant", Name: "MCP Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	srv, err := tx1.CreateMCPServer(ctx, &store.AIMCPServer{
		TenantID: tenant.ID,
		Name:     "mcp-server-1",
		URL:      "https://mcp.example.com",
		AuthKind: "bearer",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}
	if srv.ID == "" {
		t.Fatal("expected non-empty server ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetMCPServer(ctx, tenant.ID, srv.ID)
	if err != nil {
		t.Fatalf("GetMCPServer: %v", err)
	}
	if got.Name != "mcp-server-1" {
		t.Fatalf("expected name 'mcp-server-1', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListMCPServersByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListMCPServersByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one server")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newURL := "https://mcp2.example.com"
	updated, err := tx4.UpdateMCPServer(ctx, tenant.ID, srv.ID, store.UpdateAIMCPServerParams{URL: &newURL})
	if err != nil {
		t.Fatalf("UpdateMCPServer: %v", err)
	}
	if updated.URL != newURL {
		t.Fatalf("expected URL %q, got %q", newURL, updated.URL)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteMCPServer(ctx, tenant.ID, srv.ID); err != nil {
		t.Fatalf("DeleteMCPServer: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetMCPServer(ctx, tenant.ID, srv.ID); err != store.ErrMCPServerNotFound {
		t.Fatalf("expected ErrMCPServerNotFound after delete, got %v", err)
	}
	_ = tx6.Rollback()
}

func TestMySQL_AITool_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "ai-tool-tenant", Name: "AI Tool Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tool, err := tx1.CreateAITool(ctx, &store.AITool{
		TenantID:    tenant.ID,
		Name:        "web-search",
		Kind:        "http",
		Description: "Search the web",
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("CreateAITool: %v", err)
	}
	if tool.ID == "" {
		t.Fatal("expected non-empty tool ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAITool(ctx, tenant.ID, tool.ID)
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
	list, err := tx3.ListAIToolsByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListAIToolsByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one tool")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newDesc := "Search the web v2"
	updated, err := tx4.UpdateAITool(ctx, tenant.ID, tool.ID, store.UpdateAIToolParams{Description: &newDesc})
	if err != nil {
		t.Fatalf("UpdateAITool: %v", err)
	}
	if updated.Description != newDesc {
		t.Fatalf("expected description %q, got %q", newDesc, updated.Description)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAITool(ctx, tenant.ID, tool.ID); err != nil {
		t.Fatalf("DeleteAITool: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetAITool(ctx, tenant.ID, tool.ID); err != store.ErrAIToolNotFound {
		t.Fatalf("expected ErrAIToolNotFound after delete, got %v", err)
	}
	_ = tx6.Rollback()
}

func TestMySQL_AIAgent_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "ai-agent-tenant", Name: "AI Agent Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	agent, err := tx1.CreateAIAgent(ctx, &store.AIAgent{
		TenantID:     tenant.ID,
		Name:         "support-bot",
		Description:  "Customer support agent",
		Model:        "gpt-4o",
		SystemPrompt: "You are a helpful support agent.",
		Enabled:      true,
	})
	if err != nil {
		t.Fatalf("CreateAIAgent: %v", err)
	}
	if agent.ID == "" {
		t.Fatal("expected non-empty agent ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAIAgent(ctx, tenant.ID, agent.ID)
	if err != nil {
		t.Fatalf("GetAIAgent: %v", err)
	}
	if got.Name != "support-bot" {
		t.Fatalf("expected name 'support-bot', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListAIAgentsByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListAIAgentsByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one agent")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newModel := "gpt-4o-mini"
	updated, err := tx4.UpdateAIAgent(ctx, tenant.ID, agent.ID, store.UpdateAIAgentParams{Model: &newModel})
	if err != nil {
		t.Fatalf("UpdateAIAgent: %v", err)
	}
	if updated.Model != newModel {
		t.Fatalf("expected model %q, got %q", newModel, updated.Model)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAIAgent(ctx, tenant.ID, agent.ID); err != nil {
		t.Fatalf("DeleteAIAgent: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetAIAgent(ctx, tenant.ID, agent.ID); err != store.ErrAIAgentNotFound {
		t.Fatalf("expected ErrAIAgentNotFound after delete, got %v", err)
	}
	_ = tx6.Rollback()
}

func TestMySQL_AIToolBinding_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// Pre-create tenant + agent + tool (FK dependencies).
	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "binding-tenant", Name: "Binding Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	agent, err := txT.CreateAIAgent(ctx, &store.AIAgent{
		TenantID: tenant.ID,
		Name:     "binding-agent",
		Model:    "gpt-4o",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateAIAgent: %v", err)
	}
	tool, err := txT.CreateAITool(ctx, &store.AITool{
		TenantID: tenant.ID,
		Name:     "binding-tool",
		Kind:     "http",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateAITool: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	binding, err := tx1.CreateAIToolBinding(ctx, &store.AIToolBinding{
		TenantID:  tenant.ID,
		AgentID:   agent.ID,
		ToolID:    tool.ID,
		Condition: "always",
		Enabled:   true,
	})
	if err != nil {
		t.Fatalf("CreateAIToolBinding: %v", err)
	}
	if binding.ID == "" {
		t.Fatal("expected non-empty binding ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAIToolBinding(ctx, tenant.ID, binding.ID)
	if err != nil {
		t.Fatalf("GetAIToolBinding: %v", err)
	}
	if got.Condition != "always" {
		t.Fatalf("expected condition 'always', got %q", got.Condition)
	}
	_ = tx2.Rollback()

	// --- ListByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListAIToolBindingsByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListAIToolBindingsByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one binding")
	}
	_ = tx3.Rollback()

	// --- ListByAgent ---
	tx3b, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byAgent, err := tx3b.ListAIToolBindingsByAgent(ctx, agent.ID)
	if err != nil {
		t.Fatalf("ListAIToolBindingsByAgent: %v", err)
	}
	if len(byAgent) < 1 {
		t.Fatal("expected at least one binding by agent")
	}
	_ = tx3b.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newCond := "on-demand"
	updated, err := tx4.UpdateAIToolBinding(ctx, tenant.ID, binding.ID, store.UpdateAIToolBindingParams{Condition: &newCond})
	if err != nil {
		t.Fatalf("UpdateAIToolBinding: %v", err)
	}
	if updated.Condition != newCond {
		t.Fatalf("expected condition %q, got %q", newCond, updated.Condition)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAIToolBinding(ctx, tenant.ID, binding.ID); err != nil {
		t.Fatalf("DeleteAIToolBinding: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetAIToolBinding(ctx, tenant.ID, binding.ID); err != store.ErrAIBindingNotFound {
		t.Fatalf("expected ErrAIBindingNotFound after delete, got %v", err)
	}
	_ = tx6.Rollback()
}

func TestMySQL_AIRateLimit_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "rl-tenant", Name: "Rate Limit Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	rl, err := tx1.CreateAIRateLimit(ctx, &store.AISemanticRateLimit{
		TenantID:            tenant.ID,
		Name:                "no-spam",
		Scope:               "tenant",
		Exemplars:           `["buy now","click here"]`,
		SimilarityThreshold: 0.85,
		WindowSeconds:       60,
		Threshold:           10,
		Action:              "block",
		Enabled:             true,
	})
	if err != nil {
		t.Fatalf("CreateAIRateLimit: %v", err)
	}
	if rl.ID == "" {
		t.Fatal("expected non-empty rate limit ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAIRateLimit(ctx, tenant.ID, rl.ID)
	if err != nil {
		t.Fatalf("GetAIRateLimit: %v", err)
	}
	if got.Name != "no-spam" {
		t.Fatalf("expected name 'no-spam', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListAIRateLimitsByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListAIRateLimitsByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one rate limit")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newAction := "throttle"
	updated, err := tx4.UpdateAIRateLimit(ctx, tenant.ID, rl.ID, store.UpdateAIRateLimitParams{Action: &newAction})
	if err != nil {
		t.Fatalf("UpdateAIRateLimit: %v", err)
	}
	if updated.Action != newAction {
		t.Fatalf("expected action %q, got %q", newAction, updated.Action)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteAIRateLimit(ctx, tenant.ID, rl.ID); err != nil {
		t.Fatalf("DeleteAIRateLimit: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetAIRateLimit(ctx, tenant.ID, rl.ID); err != store.ErrAIRateLimitNotFound {
		t.Fatalf("expected ErrAIRateLimitNotFound after delete, got %v", err)
	}
	_ = tx6.Rollback()
}

func TestMySQL_AITrace(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// Pre-create tenant + provider + agent (FK dependencies for traces).
	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "trace-tenant", Name: "Trace Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	prov, err := txT.CreateAIProvider(ctx, &store.AIProvider{
		TenantID: tenant.ID,
		Name:     "trace-provider",
		Kind:     "openai",
		BaseURL:  "https://api.openai.com",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	agent, err := txT.CreateAIAgent(ctx, &store.AIAgent{
		TenantID: tenant.ID,
		Name:     "trace-agent",
		Model:    "gpt-4o",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateAIAgent: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Append ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	prompt := "Hello world"
	completion := "Hi there"
	tr, err := tx1.AppendAITrace(ctx, &store.AITrace{
		TenantID:     tenant.ID,
		AgentID:      &agent.ID,
		ProviderID:   &prov.ID,
		Model:        "gpt-4o",
		Status:       "success",
		InputTokens:  10,
		OutputTokens: 5,
		DurationMS:   200,
		Prompt:       &prompt,
		Completion:   &completion,
		OccurredAt:   time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("AppendAITrace: %v", err)
	}
	if tr.ID == "" {
		t.Fatal("expected non-empty trace ID")
	}
	if tr.Status != "success" {
		t.Fatalf("expected status 'success', got %q", tr.Status)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetAITrace(ctx, tenant.ID, tr.ID)
	if err != nil {
		t.Fatalf("GetAITrace: %v", err)
	}
	if got.Model != "gpt-4o" {
		t.Fatalf("expected model 'gpt-4o', got %q", got.Model)
	}
	_ = tx2.Rollback()

	// --- ListByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byTenant, err := tx3.ListAITracesByTenant(ctx, tenant.ID, store.AITraceQuery{Limit: 10})
	if err != nil {
		t.Fatalf("ListAITracesByTenant: %v", err)
	}
	if len(byTenant) < 1 {
		t.Fatal("expected at least one trace by tenant")
	}
	_ = tx3.Rollback()

	// --- ListByAgent ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	byAgent, err := tx4.ListAITracesByAgent(ctx, agent.ID, store.AITraceQuery{Limit: 10})
	if err != nil {
		t.Fatalf("ListAITracesByAgent: %v", err)
	}
	if len(byAgent) < 1 {
		t.Fatal("expected at least one trace by agent")
	}
	_ = tx4.Rollback()

	// --- ListByTenant with status filter ---
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	status := "success"
	filtered, err := tx5.ListAITracesByTenant(ctx, tenant.ID, store.AITraceQuery{
		Limit:  10,
		Status: &status,
	})
	if err != nil {
		t.Fatalf("ListAITracesByTenant (filtered): %v", err)
	}
	if len(filtered) < 1 {
		t.Fatal("expected at least one filtered trace")
	}
	_ = tx5.Rollback()

	// --- GetAITrace not found ---
	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetAITrace(ctx, tenant.ID, "nonexistent-id"); err != store.ErrAITraceNotFound {
		t.Fatalf("expected ErrAITraceNotFound, got %v", err)
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// Notification Items
// ---------------------------------------------------------------------------

func TestMySQL_NotificationItem(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "notif-item-tenant", Name: "Notif Item Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	notifEmail := "notif-user@example.com"
	user, err := txT.CreateUser(ctx, &store.User{
		Email:        &notifEmail,
		PasswordHash: "hash",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- AppendNotificationItem ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	item, err := tx1.AppendNotificationItem(ctx, &store.NotificationItem{
		TenantID:   &tenant.ID,
		UserID:     user.ID,
		Category:   "alert",
		Severity:   "warning",
		Title:      "Test Alert",
		Body:       "Something happened",
		OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("AppendNotificationItem: %v", err)
	}
	if item.ID == "" {
		t.Fatal("expected non-empty item ID")
	}
	if item.Title != "Test Alert" {
		t.Fatalf("expected title 'Test Alert', got %q", item.Title)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetNotificationItem ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetNotificationItem(ctx, item.ID)
	if err != nil {
		t.Fatalf("GetNotificationItem: %v", err)
	}
	if got.UserID != user.ID {
		t.Fatalf("expected user_id %q, got %q", user.ID, got.UserID)
	}
	_ = tx2.Rollback()

	// --- ListNotificationItemsByUser ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListNotificationItemsByUser(ctx, tenant.ID, user.ID, store.NotificationItemQuery{Limit: 10})
	if err != nil {
		t.Fatalf("ListNotificationItemsByUser: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one notification item")
	}
	_ = tx3.Rollback()

	// --- CountUnreadNotifications ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	count, err := tx4.CountUnreadNotifications(ctx, tenant.ID, user.ID)
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if count < 1 {
		t.Fatal("expected at least 1 unread notification")
	}
	_ = tx4.Rollback()

	// --- MarkNotificationRead ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.MarkNotificationRead(ctx, item.ID); err != nil {
		t.Fatalf("MarkNotificationRead: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- MarkAllNotificationsRead ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.MarkAllNotificationsRead(ctx, tenant.ID, user.ID); err != nil {
		t.Fatalf("MarkAllNotificationsRead: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ArchiveNotification ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.ArchiveNotification(ctx, item.ID, true); err != nil {
		t.Fatalf("ArchiveNotification: %v", err)
	}
	if err := tx7.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- not found ---
	tx8, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx8.GetNotificationItem(ctx, "nonexistent"); err != store.ErrNotificationItemNotFound {
		t.Fatalf("expected ErrNotificationItemNotFound, got %v", err)
	}
	_ = tx8.Rollback()
}

// ---------------------------------------------------------------------------
// Notification Channel CRUD
// ---------------------------------------------------------------------------

func TestMySQL_NotificationChannel_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "nchan-tenant", Name: "NChannel Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ch, err := tx1.CreateNotificationChannel(ctx, &store.NotificationChannel{
		TenantID: tenant.ID,
		Name:     "slack-alerts",
		Kind:     "slack",
		Config:   `{"webhook":"https://hooks.slack.com/test"}`,
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}
	if ch.ID == "" {
		t.Fatal("expected non-empty channel ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetNotificationChannel(ctx, tenant.ID, ch.ID)
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
	list, err := tx3.ListNotificationChannelsByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListNotificationChannelsByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one channel")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newName := "slack-alerts-v2"
	updated, err := tx4.UpdateNotificationChannel(ctx, tenant.ID, ch.ID, store.UpdateNotificationChannelParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateNotificationChannel: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("expected name %q, got %q", newName, updated.Name)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteNotificationChannel(ctx, tenant.ID, ch.ID); err != nil {
		t.Fatalf("DeleteNotificationChannel: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetNotificationChannel(ctx, tenant.ID, ch.ID); err != store.ErrNotificationChannelNotFound {
		t.Fatalf("expected ErrNotificationChannelNotFound, got %v", err)
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// Routing Rule CRUD
// ---------------------------------------------------------------------------

func TestMySQL_RoutingRule_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "rrule-tenant", Name: "RRule Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	rule, err := tx1.CreateRoutingRule(ctx, &store.NotificationRoutingRule{
		TenantID:    tenant.ID,
		Name:        "critical-rule",
		EventFilter: `{"severity":"critical"}`,
		ChannelIDs:  `[]`,
		Enabled:     true,
		OrderHint:   1,
	})
	if err != nil {
		t.Fatalf("CreateRoutingRule: %v", err)
	}
	if rule.ID == "" {
		t.Fatal("expected non-empty rule ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetRoutingRule(ctx, tenant.ID, rule.ID)
	if err != nil {
		t.Fatalf("GetRoutingRule: %v", err)
	}
	if got.Name != "critical-rule" {
		t.Fatalf("expected 'critical-rule', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListRoutingRulesByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListRoutingRulesByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one rule")
	}
	_ = tx3.Rollback()

	// --- Reorder ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.ReorderRoutingRules(ctx, tenant.ID, []string{rule.ID}); err != nil {
		t.Fatalf("ReorderRoutingRules: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Update ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newName := "critical-rule-v2"
	updated, err := tx5.UpdateRoutingRule(ctx, tenant.ID, rule.ID, store.UpdateRoutingRuleParams{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateRoutingRule: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("expected %q, got %q", newName, updated.Name)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeleteRoutingRule(ctx, tenant.ID, rule.ID); err != nil {
		t.Fatalf("DeleteRoutingRule: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx7.GetRoutingRule(ctx, tenant.ID, rule.ID); err != store.ErrRoutingRuleNotFound {
		t.Fatalf("expected ErrRoutingRuleNotFound, got %v", err)
	}
	_ = tx7.Rollback()
}

// ---------------------------------------------------------------------------
// Delivery Log
// ---------------------------------------------------------------------------

func TestMySQL_DeliveryLog(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "dlog-tenant", Name: "DLog Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- AppendDeliveryLogEntry ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	now := time.Now().UTC()
	entry, err := tx1.AppendDeliveryLogEntry(ctx, &store.NotificationDeliveryLogEntry{
		TenantID:         tenant.ID,
		Status:           "delivered",
		Attempts:         1,
		FirstAttemptedAt: &now,
		LastAttemptedAt:  &now,
	})
	if err != nil {
		t.Fatalf("AppendDeliveryLogEntry: %v", err)
	}
	if entry.ID == "" {
		t.Fatal("expected non-empty log entry ID")
	}
	if entry.Status != "delivered" {
		t.Fatalf("expected status 'delivered', got %q", entry.Status)
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetDeliveryLogEntry ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetDeliveryLogEntry(ctx, tenant.ID, entry.ID)
	if err != nil {
		t.Fatalf("GetDeliveryLogEntry: %v", err)
	}
	if got.TenantID != tenant.ID {
		t.Fatalf("expected tenant_id %q, got %q", tenant.ID, got.TenantID)
	}
	_ = tx2.Rollback()

	// --- ListDeliveryLogByTenant ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListDeliveryLogByTenant(ctx, tenant.ID, store.DeliveryLogQuery{Limit: 10})
	if err != nil {
		t.Fatalf("ListDeliveryLogByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one delivery log entry")
	}
	_ = tx3.Rollback()

	// --- not found ---
	tx4, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx4.GetDeliveryLogEntry(ctx, tenant.ID, "nonexistent"); err != store.ErrDeliveryLogEntryNotFound {
		t.Fatalf("expected ErrDeliveryLogEntryNotFound, got %v", err)
	}
	_ = tx4.Rollback()
}

// ---------------------------------------------------------------------------
// Tenant Notification Config
// ---------------------------------------------------------------------------

func TestMySQL_TenantNotificationConfig(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "tnc-tenant", Name: "TNC Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetTenantNotificationConfig (default on no row) ---
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetTenantNotificationConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetTenantNotificationConfig (default): %v", err)
	}
	if !def.Enabled {
		t.Fatal("expected default enabled=true")
	}
	_ = tx1.Rollback()

	// --- UpsertTenantNotificationConfig ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upserted, err := tx2.UpsertTenantNotificationConfig(ctx, &store.TenantNotificationConfig{
		TenantID:            tenant.ID,
		Enabled:             true,
		OptInMode:           "opt-out",
		MaxRetries:          5,
		RetryBackoffSeconds: 60,
		ChannelPriority:     `["email"]`,
	})
	if err != nil {
		t.Fatalf("UpsertTenantNotificationConfig: %v", err)
	}
	if upserted.OptInMode != "opt-out" {
		t.Fatalf("expected opt_in_mode 'opt-out', got %q", upserted.OptInMode)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get after upsert ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetTenantNotificationConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetTenantNotificationConfig: %v", err)
	}
	if got.MaxRetries != 5 {
		t.Fatalf("expected max_retries 5, got %d", got.MaxRetries)
	}
	_ = tx3.Rollback()
}

// ---------------------------------------------------------------------------
// Plugin CRUD
// ---------------------------------------------------------------------------

func TestMySQL_Plugin_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// --- Create global plugin (tenant_scope = nil) ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	plug, err := tx1.CreatePlugin(ctx, &store.Plugin{
		Slug:    "rate-limiter",
		Name:    "Rate Limiter",
		Version: "1.0.0",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreatePlugin: %v", err)
	}
	if plug.ID == "" {
		t.Fatal("expected non-empty plugin ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get (global scope) ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetPlugin(ctx, "", plug.ID)
	if err != nil {
		t.Fatalf("GetPlugin: %v", err)
	}
	if got.Slug != "rate-limiter" {
		t.Fatalf("expected slug 'rate-limiter', got %q", got.Slug)
	}
	_ = tx2.Rollback()

	// --- List by scope ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListPluginsByScope(ctx, "")
	if err != nil {
		t.Fatalf("ListPluginsByScope: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one global plugin")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newVer := "1.1.0"
	updated, err := tx4.UpdatePlugin(ctx, "", plug.ID, store.UpdatePluginParams{Version: &newVer})
	if err != nil {
		t.Fatalf("UpdatePlugin: %v", err)
	}
	if updated.Version != newVer {
		t.Fatalf("expected version %q, got %q", newVer, updated.Version)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ListPluginsBySigner (empty, just verify no error) ---
	tx5, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	_, err = tx5.ListPluginsBySigner(ctx, "nonexistent-signer")
	if err != nil {
		t.Fatalf("ListPluginsBySigner: %v", err)
	}
	_ = tx5.Rollback()

	// --- Delete ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx6.DeletePlugin(ctx, "", plug.ID); err != nil {
		t.Fatalf("DeletePlugin: %v", err)
	}
	if err := tx6.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx7, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx7.GetPlugin(ctx, "", plug.ID); err != store.ErrPluginNotFound {
		t.Fatalf("expected ErrPluginNotFound, got %v", err)
	}
	_ = tx7.Rollback()
}

// ---------------------------------------------------------------------------
// PluginSigner CRUD
// ---------------------------------------------------------------------------

func TestMySQL_PluginSigner_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	signer, err := tx1.CreatePluginSigner(ctx, &store.PluginSigner{
		Name:        "Rioku Official",
		Fingerprint: "SHA256:abc123def456",
		Status:      "trusted",
	})
	if err != nil {
		t.Fatalf("CreatePluginSigner: %v", err)
	}
	if signer.ID == "" {
		t.Fatal("expected non-empty signer ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetPluginSigner(ctx, "", signer.ID)
	if err != nil {
		t.Fatalf("GetPluginSigner: %v", err)
	}
	if got.Fingerprint != "SHA256:abc123def456" {
		t.Fatalf("expected fingerprint, got %q", got.Fingerprint)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListPluginSignersByScope(ctx, "")
	if err != nil {
		t.Fatalf("ListPluginSignersByScope: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one signer")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newStatus := "revoked"
	updated, err := tx4.UpdatePluginSigner(ctx, "", signer.ID, store.UpdatePluginSignerParams{Status: &newStatus})
	if err != nil {
		t.Fatalf("UpdatePluginSigner: %v", err)
	}
	if updated.Status != newStatus {
		t.Fatalf("expected status %q, got %q", newStatus, updated.Status)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeletePluginSigner(ctx, "", signer.ID); err != nil {
		t.Fatalf("DeletePluginSigner: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetPluginSigner(ctx, "", signer.ID); err != store.ErrPluginSignerNotFound {
		t.Fatalf("expected ErrPluginSignerNotFound, got %v", err)
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// CertAuthority CRUD
// ---------------------------------------------------------------------------

func TestMySQL_CertAuthority_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "ca-tenant", Name: "CA Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ca, err := tx1.CreateCertAuthority(ctx, &store.CertAuthority{
		TenantID:       tenant.ID,
		Name:           "Test CA",
		Kind:           "internal",
		Subject:        "CN=Test CA,O=Rioku",
		CertificatePEM: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
	})
	if err != nil {
		t.Fatalf("CreateCertAuthority: %v", err)
	}
	if ca.ID == "" {
		t.Fatal("expected non-empty CA ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetCertAuthority(ctx, tenant.ID, ca.ID)
	if err != nil {
		t.Fatalf("GetCertAuthority: %v", err)
	}
	if got.Name != "Test CA" {
		t.Fatalf("expected name 'Test CA', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListCertAuthoritiesByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListCertAuthoritiesByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one CA")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newKind := "external"
	updated, err := tx4.UpdateCertAuthority(ctx, tenant.ID, ca.ID, store.UpdateCertAuthorityParams{Kind: &newKind})
	if err != nil {
		t.Fatalf("UpdateCertAuthority: %v", err)
	}
	if updated.Kind != newKind {
		t.Fatalf("expected kind %q, got %q", newKind, updated.Kind)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteCertAuthority(ctx, tenant.ID, ca.ID); err != nil {
		t.Fatalf("DeleteCertAuthority: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetCertAuthority(ctx, tenant.ID, ca.ID); err != store.ErrCertAuthorityNotFound {
		t.Fatalf("expected ErrCertAuthorityNotFound, got %v", err)
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// CertEnrollment CRUD
// ---------------------------------------------------------------------------

func TestMySQL_CertEnrollment_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// Pre-create tenant + CA (FK dependency for enrollments).
	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "ce-tenant", Name: "CE Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	ca, err := txT.CreateCertAuthority(ctx, &store.CertAuthority{
		TenantID:       tenant.ID,
		Name:           "Enroll CA",
		Kind:           "internal",
		Subject:        "CN=Enroll CA,O=Rioku",
		CertificatePEM: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
	})
	if err != nil {
		t.Fatalf("CreateCertAuthority: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	enroll, err := tx1.CreateCertEnrollment(ctx, &store.CertEnrollment{
		TenantID: tenant.ID,
		CAID:     &ca.ID,
		Subject:  "CN=node1.example.com",
		DNSSANs:  `["node1.example.com"]`,
		State:    "pending",
	})
	if err != nil {
		t.Fatalf("CreateCertEnrollment: %v", err)
	}
	if enroll.ID == "" {
		t.Fatal("expected non-empty enrollment ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetCertEnrollment(ctx, tenant.ID, enroll.ID)
	if err != nil {
		t.Fatalf("GetCertEnrollment: %v", err)
	}
	if got.State != "pending" {
		t.Fatalf("expected state 'pending', got %q", got.State)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListCertEnrollmentsByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListCertEnrollmentsByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one enrollment")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newState := "issued"
	issuedAt := time.Now().UTC()
	certPEM := "-----BEGIN CERTIFICATE-----\nfake-issued\n-----END CERTIFICATE-----"
	updated, err := tx4.UpdateCertEnrollment(ctx, tenant.ID, enroll.ID, store.UpdateCertEnrollmentParams{
		State:          &newState,
		IssuedAt:       &issuedAt,
		CertificatePEM: &certPEM,
	})
	if err != nil {
		t.Fatalf("UpdateCertEnrollment: %v", err)
	}
	if updated.State != newState {
		t.Fatalf("expected state %q, got %q", newState, updated.State)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- RevokeCertEnrollmentRow (returns *CertEnrollment) ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	revoked, err := tx5.RevokeCertEnrollmentRow(ctx, tenant.ID, enroll.ID, "key-compromise")
	if err != nil {
		t.Fatalf("RevokeCertEnrollmentRow: %v", err)
	}
	if revoked.State != "revoked" {
		t.Fatalf("expected state 'revoked', got %q", revoked.State)
	}
	if revoked.RevocationReason == nil || *revoked.RevocationReason != "key-compromise" {
		t.Fatalf("expected revocation_reason 'key-compromise', got %v", revoked.RevocationReason)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
}

// ---------------------------------------------------------------------------
// TLSCertificate CRUD
// ---------------------------------------------------------------------------

func TestMySQL_TLSCertificate_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "tlscert-tenant", Name: "TLSCert Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	cert, err := tx1.CreateTLSCertificate(ctx, &store.TLSCertificate{
		TenantID:       tenant.ID,
		Domain:         "api.example.com",
		Issuer:         "Let's Encrypt",
		Source:         "acme",
		AutoRenew:      true,
		CertificatePEM: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
	})
	if err != nil {
		t.Fatalf("CreateTLSCertificate: %v", err)
	}
	if cert.ID == "" {
		t.Fatal("expected non-empty cert ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetTLSCertificate(ctx, tenant.ID, cert.ID)
	if err != nil {
		t.Fatalf("GetTLSCertificate: %v", err)
	}
	if got.Domain != "api.example.com" {
		t.Fatalf("expected domain 'api.example.com', got %q", got.Domain)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListTLSCertificatesByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListTLSCertificatesByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one TLS certificate")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newIssuer := "ZeroSSL"
	updated, err := tx4.UpdateTLSCertificate(ctx, tenant.ID, cert.ID, store.UpdateTLSCertificateParams{Issuer: &newIssuer})
	if err != nil {
		t.Fatalf("UpdateTLSCertificate: %v", err)
	}
	if updated.Issuer != newIssuer {
		t.Fatalf("expected issuer %q, got %q", newIssuer, updated.Issuer)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteTLSCertificate(ctx, tenant.ID, cert.ID); err != nil {
		t.Fatalf("DeleteTLSCertificate: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetTLSCertificate(ctx, tenant.ID, cert.ID); err != store.ErrTLSCertificateNotFound {
		t.Fatalf("expected ErrTLSCertificateNotFound, got %v", err)
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// TLSConfig singleton
// ---------------------------------------------------------------------------

func TestMySQL_TLSConfig(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "tlsconf-tenant", Name: "TLSConf Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetTLSConfig (default on no row) ---
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetTLSConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetTLSConfig (default): %v", err)
	}
	if def.ACMEProvider != "lets-encrypt" {
		t.Fatalf("expected default provider 'lets-encrypt', got %q", def.ACMEProvider)
	}
	_ = tx1.Rollback()

	// --- UpsertTLSConfig ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upserted, err := tx2.UpsertTLSConfig(ctx, &store.TLSConfig{
		TenantID:       tenant.ID,
		ACMEProvider:   "zerossl",
		ACMEEmail:      "admin@example.com",
		AllowedCiphers: `["TLS_AES_256_GCM_SHA384"]`,
		MinProtocol:    "1.3",
	})
	if err != nil {
		t.Fatalf("UpsertTLSConfig: %v", err)
	}
	if upserted.ACMEProvider != "zerossl" {
		t.Fatalf("expected provider 'zerossl', got %q", upserted.ACMEProvider)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get after upsert ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetTLSConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetTLSConfig: %v", err)
	}
	if got.MinProtocol != "1.3" {
		t.Fatalf("expected min_protocol '1.3', got %q", got.MinProtocol)
	}
	_ = tx3.Rollback()
}

// ---------------------------------------------------------------------------
// NetworkConfig singleton
// ---------------------------------------------------------------------------

func TestMySQL_NetworkConfig(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "netconf-tenant", Name: "NetConf Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetNetworkConfig (default on no row) ---
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetNetworkConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetNetworkConfig (default): %v", err)
	}
	if def.ReadTimeoutSeconds != 60 {
		t.Fatalf("expected default read_timeout 60, got %d", def.ReadTimeoutSeconds)
	}
	_ = tx1.Rollback()

	// --- Upsert ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upserted, err := tx2.UpsertNetworkConfig(ctx, &store.NetworkConfig{
		TenantID:             tenant.ID,
		ListenAddresses:      `[":7778"]`,
		HTTP3Enabled:         true,
		CaddyConfigOverrides: `{}`,
		ReadTimeoutSeconds:   30,
		WriteTimeoutSeconds:  30,
		IdleTimeoutSeconds:   90,
	})
	if err != nil {
		t.Fatalf("UpsertNetworkConfig: %v", err)
	}
	if !upserted.HTTP3Enabled {
		t.Fatal("expected http3_enabled=true")
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get after upsert ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetNetworkConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetNetworkConfig: %v", err)
	}
	if got.ReadTimeoutSeconds != 30 {
		t.Fatalf("expected read_timeout 30, got %d", got.ReadTimeoutSeconds)
	}
	_ = tx3.Rollback()
}

// ---------------------------------------------------------------------------
// TenantAuthPolicy singleton
// ---------------------------------------------------------------------------

func TestMySQL_TenantAuthPolicy(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "authpol-tenant", Name: "AuthPol Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetTenantAuthPolicy (default) ---
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetTenantAuthPolicy(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetTenantAuthPolicy (default): %v", err)
	}
	if def.TOTPPolicy != "optional" {
		t.Fatalf("expected default totp_policy 'optional', got %q", def.TOTPPolicy)
	}
	_ = tx1.Rollback()

	// --- Upsert ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upserted, err := tx2.UpsertTenantAuthPolicy(ctx, &store.TenantAuthPolicy{
		TenantID:          tenant.ID,
		TOTPPolicy:        "required",
		MinLength:         16,
		RequireUppercase:  true,
		RequireDigit:      true,
		IdleHours:         12,
		AbsoluteHours:     72,
		MaxFailedAttempts: 3,
		LockoutMinutes:    30,
	})
	if err != nil {
		t.Fatalf("UpsertTenantAuthPolicy: %v", err)
	}
	if upserted.TOTPPolicy != "required" {
		t.Fatalf("expected totp_policy 'required', got %q", upserted.TOTPPolicy)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get after upsert ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetTenantAuthPolicy(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetTenantAuthPolicy: %v", err)
	}
	if got.MinLength != 16 {
		t.Fatalf("expected min_length 16, got %d", got.MinLength)
	}
	_ = tx3.Rollback()
}

// ---------------------------------------------------------------------------
// ObservabilityConfig singleton
// ---------------------------------------------------------------------------

func TestMySQL_ObservabilityConfig(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "obsconf-tenant", Name: "ObsConf Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetObservabilityConfig (default) ---
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetObservabilityConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetObservabilityConfig (default): %v", err)
	}
	if def.LogFormat != "json" {
		t.Fatalf("expected default log_format 'json', got %q", def.LogFormat)
	}
	_ = tx1.Rollback()

	// --- Upsert ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upserted, err := tx2.UpsertObservabilityConfig(ctx, &store.ObservabilityConfig{
		TenantID:             tenant.ID,
		MetricsScrapeAuth:    "{}",
		MetricsRetentionDays: 14,
		LogLevels:            "{}",
		LogFormat:            "logfmt",
		LogRotation:          "{}",
		TracesRetentionDays:  3,
		TracesSampleRate:     0.5,
	})
	if err != nil {
		t.Fatalf("UpsertObservabilityConfig: %v", err)
	}
	if upserted.LogFormat != "logfmt" {
		t.Fatalf("expected log_format 'logfmt', got %q", upserted.LogFormat)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get after upsert ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetObservabilityConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetObservabilityConfig: %v", err)
	}
	if got.TracesSampleRate != 0.5 {
		t.Fatalf("expected sample_rate 0.5, got %f", got.TracesSampleRate)
	}
	_ = tx3.Rollback()
}

// ---------------------------------------------------------------------------
// AuditRetentionConfig singleton
// ---------------------------------------------------------------------------

func TestMySQL_AuditRetentionConfig(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "arc-tenant", Name: "ARC Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetAuditRetentionConfig (default) ---
	tx1, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	def, err := tx1.GetAuditRetentionConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetAuditRetentionConfig (default): %v", err)
	}
	if def.AutoExport != "never" {
		t.Fatalf("expected default auto_export 'never', got %q", def.AutoExport)
	}
	_ = tx1.Rollback()

	// --- Upsert ---
	tx2, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	upserted, err := tx2.UpsertAuditRetentionConfig(ctx, &store.AuditRetentionConfig{
		TenantID:                 tenant.ID,
		RetentionDaysRead:        7,
		RetentionDaysWrite:       30,
		RetentionDaysDestructive: 180,
		AutoExport:               "weekly",
		AutoExportFormat:         "csv",
	})
	if err != nil {
		t.Fatalf("UpsertAuditRetentionConfig: %v", err)
	}
	if upserted.AutoExport != "weekly" {
		t.Fatalf("expected auto_export 'weekly', got %q", upserted.AutoExport)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get after upsert ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx3.GetAuditRetentionConfig(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("GetAuditRetentionConfig: %v", err)
	}
	if got.RetentionDaysRead != 7 {
		t.Fatalf("expected retention_days_read 7, got %d", got.RetentionDaysRead)
	}
	_ = tx3.Rollback()
}

// ---------------------------------------------------------------------------
// WebhookEndpoint CRUD
// ---------------------------------------------------------------------------

func TestMySQL_WebhookEndpoint_CRUD(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenant, err := txT.CreateTenant(ctx, &store.Tenant{Slug: "webhook-tenant", Name: "Webhook Tenant"})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Create ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	hook, err := tx1.CreateWebhookEndpoint(ctx, &store.WebhookEndpoint{
		TenantID: tenant.ID,
		Name:     "deploy-hook",
		URL:      "https://webhook.example.com/deploy",
		Events:   `["deploy.success","deploy.failure"]`,
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateWebhookEndpoint: %v", err)
	}
	if hook.ID == "" {
		t.Fatal("expected non-empty webhook ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Get ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetWebhookEndpoint(ctx, tenant.ID, hook.ID)
	if err != nil {
		t.Fatalf("GetWebhookEndpoint: %v", err)
	}
	if got.Name != "deploy-hook" {
		t.Fatalf("expected name 'deploy-hook', got %q", got.Name)
	}
	_ = tx2.Rollback()

	// --- List ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	list, err := tx3.ListWebhookEndpointsByTenant(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("ListWebhookEndpointsByTenant: %v", err)
	}
	if len(list) < 1 {
		t.Fatal("expected at least one webhook endpoint")
	}
	_ = tx3.Rollback()

	// --- Update ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	newURL := "https://webhook.example.com/deploy-v2"
	updated, err := tx4.UpdateWebhookEndpoint(ctx, tenant.ID, hook.ID, store.UpdateWebhookEndpointParams{URL: &newURL})
	if err != nil {
		t.Fatalf("UpdateWebhookEndpoint: %v", err)
	}
	if updated.URL != newURL {
		t.Fatalf("expected url %q, got %q", newURL, updated.URL)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- Delete ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx5.DeleteWebhookEndpoint(ctx, tenant.ID, hook.ID); err != nil {
		t.Fatalf("DeleteWebhookEndpoint: %v", err)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	tx6, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.GetWebhookEndpoint(ctx, tenant.ID, hook.ID); err != store.ErrWebhookEndpointNotFound {
		t.Fatalf("expected ErrWebhookEndpointNotFound, got %v", err)
	}
	_ = tx6.Rollback()
}

// ---------------------------------------------------------------------------
// Enrollment Token
// ---------------------------------------------------------------------------

func TestMySQL_EnrollmentToken(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// --- CreateEnrollmentToken ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	expires := time.Now().UTC().Add(24 * time.Hour)
	tok, err := tx1.CreateEnrollmentToken(ctx, &store.ClusterEnrollmentToken{
		TokenHash: "sha256-test-hash-for-enrollment",
		ExpiresAt: expires,
		Notes:     "test token",
	})
	if err != nil {
		t.Fatalf("CreateEnrollmentToken: %v", err)
	}
	if tok.ID == "" {
		t.Fatal("expected non-empty token ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetEnrollmentTokenByHash ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetEnrollmentTokenByHash(ctx, "sha256-test-hash-for-enrollment")
	if err != nil {
		t.Fatalf("GetEnrollmentTokenByHash: %v", err)
	}
	if got.ID != tok.ID {
		t.Fatalf("expected id %q, got %q", tok.ID, got.ID)
	}
	_ = tx2.Rollback()

	// --- ListActiveEnrollmentTokens ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	active, err := tx3.ListActiveEnrollmentTokens(ctx)
	if err != nil {
		t.Fatalf("ListActiveEnrollmentTokens: %v", err)
	}
	if len(active) < 1 {
		t.Fatal("expected at least one active token")
	}
	_ = tx3.Rollback()

	// --- ConsumeEnrollmentToken (returns *ClusterEnrollmentToken) ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	consumed, err := tx4.ConsumeEnrollmentToken(ctx, "sha256-test-hash-for-enrollment", "node-abc")
	if err != nil {
		t.Fatalf("ConsumeEnrollmentToken: %v", err)
	}
	if consumed.ConsumedAt == nil {
		t.Fatal("expected consumed_at to be set")
	}
	if consumed.ConsumedByNodeID == nil || *consumed.ConsumedByNodeID != "node-abc" {
		t.Fatalf("expected consumed_by_node_id 'node-abc', got %v", consumed.ConsumedByNodeID)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- ConsumeEnrollmentToken again → already used ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx5.ConsumeEnrollmentToken(ctx, "sha256-test-hash-for-enrollment", "node-xyz"); err != store.ErrEnrollmentTokenAlreadyUsed {
		t.Fatalf("expected ErrEnrollmentTokenAlreadyUsed, got %v", err)
	}
	_ = tx5.Rollback()

	// --- RevokeEnrollmentToken (new token) ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tok2, err := tx6.CreateEnrollmentToken(ctx, &store.ClusterEnrollmentToken{
		TokenHash: "sha256-test-hash-to-revoke",
		ExpiresAt: time.Now().UTC().Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateEnrollmentToken (revoke test): %v", err)
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
}

// ---------------------------------------------------------------------------
// Impersonation Session
// ---------------------------------------------------------------------------

func TestMySQL_ImpersonationSession(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	// Pre-create a user to act as super_admin_id.
	txT, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	impEmail := "impersonation-admin@example.com"
	admin, err := txT.CreateUser(ctx, &store.User{
		Email:        &impEmail,
		PasswordHash: "hash",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := txT.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- CreateImpersonationSession ---
	tx1, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	expires := time.Now().UTC().Add(1 * time.Hour)
	sess, err := tx1.CreateImpersonationSession(ctx, &store.ImpersonationSession{
		SuperAdminID: admin.ID,
		Reason:       "support investigation",
		StartedAt:    time.Now().UTC(),
		ExpiresAt:    expires,
	})
	if err != nil {
		t.Fatalf("CreateImpersonationSession: %v", err)
	}
	if sess.ID == "" {
		t.Fatal("expected non-empty session ID")
	}
	if err := tx1.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- GetImpersonationSession ---
	tx2, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	got, err := tx2.GetImpersonationSession(ctx, sess.ID)
	if err != nil {
		t.Fatalf("GetImpersonationSession: %v", err)
	}
	if got.Reason != "support investigation" {
		t.Fatalf("expected reason 'support investigation', got %q", got.Reason)
	}
	_ = tx2.Rollback()

	// --- ListActiveImpersonationSessions ---
	tx3, err := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	active, err := tx3.ListActiveImpersonationSessions(ctx)
	if err != nil {
		t.Fatalf("ListActiveImpersonationSessions: %v", err)
	}
	if len(active) < 1 {
		t.Fatal("expected at least one active session")
	}
	_ = tx3.Rollback()

	// --- TouchImpersonationSession ---
	tx4, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx4.TouchImpersonationSession(ctx, sess.ID); err != nil {
		t.Fatalf("TouchImpersonationSession: %v", err)
	}
	if err := tx4.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- EndImpersonationSession (returns *ImpersonationSession) ---
	tx5, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ended, err := tx5.EndImpersonationSession(ctx, sess.ID, "explicit_exit")
	if err != nil {
		t.Fatalf("EndImpersonationSession: %v", err)
	}
	if ended.EndedAt == nil {
		t.Fatal("expected ended_at to be set")
	}
	if ended.EndReason == nil || *ended.EndReason != "explicit_exit" {
		t.Fatalf("expected end_reason 'explicit_exit', got %v", ended.EndReason)
	}
	if err := tx5.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// --- EndImpersonationSession again → already ended ---
	tx6, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if _, err := tx6.EndImpersonationSession(ctx, sess.ID, "repeat"); err != store.ErrImpersonationSessionEnded {
		t.Fatalf("expected ErrImpersonationSessionEnded, got %v", err)
	}
	_ = tx6.Rollback()

	// --- TouchImpersonationSession on ended session → not found ---
	tx7, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx7.TouchImpersonationSession(ctx, sess.ID); err != store.ErrImpersonationSessionNotFound {
		t.Fatalf("expected ErrImpersonationSessionNotFound on ended session, got %v", err)
	}
	_ = tx7.Rollback()
}

// TestMySQL_Service_CaddyPrimitives_RoundTrip verifies that Phase 7a / #161
// service-level Caddy primitive fields persist and round-trip through the
// MySQL driver. Skipped when MYSQL_TEST_DSN is unset.
func TestMySQL_Service_CaddyPrimitives_RoundTrip(t *testing.T) {
	d := openMySQLTestDB(t)
	ctx := context.Background()

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	created, err := tx.CreateService(ctx, &riokuv1.Service{
		Name:     "mysql-prim-svc",
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
