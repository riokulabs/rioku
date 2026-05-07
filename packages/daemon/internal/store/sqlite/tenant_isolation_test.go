package sqlite

import (
	"context"
	"testing"

	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// TestTenantIsolation_RoutesServicesPolicies asserts that rows created
// under tenant A are invisible from tenant B's context. It exercises
// the tenant-id filter applied in the sqlite layer for routes, services,
// policies, api_keys, audit log, and access_policies.
func TestTenantIsolation_RoutesServicesPolicies(t *testing.T) {
	d := openTestDB(t)
	bg := context.Background()

	// Seed a second tenant so we have two distinct tenant ids to operate under.
	tx, err := d.Begin(bg, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenantB, err := tx.CreateTenant(bg, &store.Tenant{
		Slug: "tenant-b-isolation",
		Name: "Tenant B",
		Plan: "community",
	})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	ctxA := store.WithTenantID(bg, store.DefaultTenantID)
	ctxB := store.WithTenantID(bg, tenantB.ID)

	// Create a service + route in tenant A.
	tx, err = d.Begin(ctxA, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin A: %v", err)
	}
	svcA, err := tx.CreateService(ctxA, &riokuv1.Service{
		Name:     "isolation-svc-a",
		LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:9001", Weight: 1, Healthy: true},
		},
	})
	if err != nil {
		t.Fatalf("CreateService A: %v", err)
	}
	routeA, err := tx.CreateRoute(ctxA, &riokuv1.Route{
		Name:    "isolation-route-a",
		Target:  &riokuv1.Route_ServiceId{ServiceId: svcA.GetId()},
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateRoute A: %v", err)
	}
	if _, err := tx.CreatePolicy(ctxA, &riokuv1.Policy{
		Name: "isolation-policy-a",
		Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
	}); err != nil {
		t.Fatalf("CreatePolicy A: %v", err)
	}
	if _, err := tx.CreateAPIKey(ctxA, "key-a", "hash-a", "", []string{"*"}, nil, ""); err != nil {
		t.Fatalf("CreateAPIKey A: %v", err)
	}
	if err := tx.AppendAuditEntry(ctxA, &riokuv1.AuditEntry{
		Actor:      "test-actor-a",
		EntityType: "route",
		EntityId:   routeA.GetId(),
		Operation:  "create",
	}); err != nil {
		t.Fatalf("AppendAuditEntry A: %v", err)
	}
	if _, err := tx.CreateAccessPolicy(ctxA, &store.AccessPolicy{
		Name:       "ap-a",
		Effect:     store.AccessPolicyAllow,
		TargetType: store.AccessPolicyTargetRoles,
		TargetIDs:  []string{"role_superadmin"},
		Priority:   100,
		Enabled:    true,
	}); err != nil {
		t.Fatalf("CreateAccessPolicy A: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit A: %v", err)
	}

	// Query as tenant B — every list must come back empty, every direct
	// get of tenant A's row id must return not-found.
	tx, err = d.Begin(ctxB, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin B: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	if rs, err := tx.ListRoutes(ctxB); err != nil {
		t.Fatalf("ListRoutes B: %v", err)
	} else if len(rs) != 0 {
		t.Errorf("ListRoutes B: expected 0, got %d", len(rs))
	}
	if ss, err := tx.ListServices(ctxB); err != nil {
		t.Fatalf("ListServices B: %v", err)
	} else if len(ss) != 0 {
		t.Errorf("ListServices B: expected 0, got %d", len(ss))
	}
	if ps, err := tx.ListPolicies(ctxB); err != nil {
		t.Fatalf("ListPolicies B: %v", err)
	} else if len(ps) != 0 {
		t.Errorf("ListPolicies B: expected 0, got %d", len(ps))
	}
	if ks, err := tx.ListAPIKeys(ctxB); err != nil {
		t.Fatalf("ListAPIKeys B: %v", err)
	} else if len(ks) != 0 {
		t.Errorf("ListAPIKeys B: expected 0, got %d", len(ks))
	}
	if es, err := tx.QueryAuditLog(ctxB, store.AuditQuery{}); err != nil {
		t.Fatalf("QueryAuditLog B: %v", err)
	} else if len(es) != 0 {
		t.Errorf("QueryAuditLog B: expected 0, got %d", len(es))
	}
	if aps, err := tx.ListAccessPolicies(ctxB); err != nil {
		t.Fatalf("ListAccessPolicies B: %v", err)
	} else if len(aps) != 0 {
		t.Errorf("ListAccessPolicies B: expected 0, got %d", len(aps))
	}

	// Direct gets by id must also miss.
	if _, err := tx.GetRoute(ctxB, routeA.GetId()); err == nil {
		t.Error("GetRoute B: expected not-found, got nil")
	}
	if _, err := tx.GetService(ctxB, svcA.GetId()); err == nil {
		t.Error("GetService B: expected not-found, got nil")
	}

	// Cross-tenant DELETE must be a no-op (returns not-found).
	if err := tx.DeleteRoute(ctxB, routeA.GetId()); err == nil {
		t.Error("DeleteRoute B: expected not-found error, got nil")
	}
	if err := tx.DeleteService(ctxB, svcA.GetId()); err == nil {
		t.Error("DeleteService B: expected not-found error, got nil")
	}

	// Tenant A still sees its own rows.
	txA, err := d.Begin(ctxA, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin A2: %v", err)
	}
	defer func() { _ = txA.Rollback() }()
	if rs, err := txA.ListRoutes(ctxA); err != nil {
		t.Fatalf("ListRoutes A: %v", err)
	} else if len(rs) == 0 {
		t.Error("ListRoutes A: expected route still present, got 0")
	}
}

// TestTenantIsolation_BuiltinRolesVisibleAcrossTenants asserts that
// global (NULL tenant_id) roles like the seeded built-ins are visible
// from every tenant, while custom roles are tenant-scoped.
func TestTenantIsolation_BuiltinRolesVisibleAcrossTenants(t *testing.T) {
	d := openTestDB(t)
	bg := context.Background()

	tx, err := d.Begin(bg, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	tenantB, err := tx.CreateTenant(bg, &store.Tenant{
		Slug: "tenant-b-roles",
		Name: "Tenant B",
		Plan: "community",
	})
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	ctxA := store.WithTenantID(bg, store.DefaultTenantID)
	ctxB := store.WithTenantID(bg, tenantB.ID)

	// Tenant A creates a custom role.
	tx, err = d.Begin(ctxA, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin A: %v", err)
	}
	customRole, err := tx.CreateRole(ctxA, store.CreateRoleParams{
		ID:          "role_custom_a",
		Name:        "Custom A",
		Description: "tenant-A-only",
		Permissions: []string{},
	})
	if err != nil {
		t.Fatalf("CreateRole A: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit A: %v", err)
	}

	// Tenant B should see built-in roles but NOT tenant A's custom role.
	tx, err = d.Begin(ctxB, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin B: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	roles, err := tx.ListRoles(ctxB)
	if err != nil {
		t.Fatalf("ListRoles B: %v", err)
	}
	var hasSuperadmin, hasCustomA bool
	for _, r := range roles {
		if r.ID == "role_superadmin" {
			hasSuperadmin = true
		}
		if r.ID == customRole.ID {
			hasCustomA = true
		}
	}
	if !hasSuperadmin {
		t.Error("ListRoles B: expected built-in superadmin role to be visible")
	}
	if hasCustomA {
		t.Error("ListRoles B: tenant A's custom role leaked across tenants")
	}

	// Direct GetRole for tenant A's custom role from tenant B must miss.
	if _, err := tx.GetRole(ctxB, customRole.ID); err != store.ErrRoleNotFound {
		t.Errorf("GetRole B for tenant A's custom role: expected ErrRoleNotFound, got %v", err)
	}
}
