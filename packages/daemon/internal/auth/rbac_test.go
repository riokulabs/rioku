package auth_test

import (
	"context"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// ---------------------------------------------------------------------------
// ResolvePermissions
// ---------------------------------------------------------------------------

func TestResolvePermissions_Basic(t *testing.T) {
	roles := []store.Role{
		{ID: "role_viewer", Name: "viewer"},
	}
	rolePerms := map[string][]string{
		"role_viewer": {"config:read", "audit:read"},
	}

	scopes := auth.ResolvePermissions(roles, rolePerms)
	if len(scopes) != 2 {
		t.Fatalf("expected 2 scopes, got %d: %v", len(scopes), scopes)
	}
}

func TestResolvePermissions_Deduplicated(t *testing.T) {
	roles := []store.Role{
		{ID: "role_a"},
		{ID: "role_b"},
	}
	rolePerms := map[string][]string{
		"role_a": {"config:read", "audit:read"},
		"role_b": {"audit:read", "traffic:read"},
	}

	scopes := auth.ResolvePermissions(roles, rolePerms)
	// Should be 3: config:read, audit:read, traffic:read (deduplicated).
	if len(scopes) != 3 {
		t.Fatalf("expected 3 deduplicated scopes, got %d: %v", len(scopes), scopes)
	}

	// Verify uniqueness.
	seen := make(map[string]bool)
	for _, s := range scopes {
		if seen[s] {
			t.Errorf("duplicate scope: %s", s)
		}
		seen[s] = true
	}
}

func TestResolvePermissions_Wildcard(t *testing.T) {
	roles := []store.Role{
		{ID: "role_superadmin"},
	}
	rolePerms := map[string][]string{
		"role_superadmin": {"*"},
	}

	scopes := auth.ResolvePermissions(roles, rolePerms)
	if len(scopes) != 1 || scopes[0] != "*" {
		t.Fatalf("expected [*], got %v", scopes)
	}
}

func TestResolvePermissions_EmptyRoles(t *testing.T) {
	scopes := auth.ResolvePermissions(nil, nil)
	if len(scopes) != 0 {
		t.Fatalf("expected empty scopes for nil roles, got %v", scopes)
	}
}

func TestResolvePermissions_MissingRoleInMap(t *testing.T) {
	roles := []store.Role{
		{ID: "role_missing"},
	}
	rolePerms := map[string][]string{}

	scopes := auth.ResolvePermissions(roles, rolePerms)
	if len(scopes) != 0 {
		t.Fatalf("expected empty scopes for missing role, got %v", scopes)
	}
}

// ---------------------------------------------------------------------------
// LoadUserScopes — integration test with real SQLite store
// ---------------------------------------------------------------------------

func TestLoadUserScopes_WithRole(t *testing.T) {
	drv := setupTestStore(t)
	ctx := context.Background()

	// Create a test user.
	user := createTestUser(t, drv, "rbac_user")

	// Assign the viewer role.
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx.AssignRole(ctx, user.ID, "role_viewer", ""); err != nil {
		_ = tx.Rollback()
		t.Fatalf("AssignRole: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	roles, scopes, err := auth.LoadUserScopes(ctx, drv, user.ID)
	if err != nil {
		t.Fatalf("LoadUserScopes: %v", err)
	}

	if len(roles) != 1 || roles[0] != "viewer" {
		t.Errorf("expected roles=[viewer], got %v", roles)
	}

	// Viewer has: config:read, audit:read, settings:read, traffic:read, plugins:read, cluster:read
	if len(scopes) != 6 {
		t.Errorf("expected 6 scopes for viewer, got %d: %v", len(scopes), scopes)
	}
}

func TestLoadUserScopes_NoRoles(t *testing.T) {
	drv := setupTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, drv, "noroles_user")

	roles, scopes, err := auth.LoadUserScopes(ctx, drv, user.ID)
	if err != nil {
		t.Fatalf("LoadUserScopes: %v", err)
	}

	if len(roles) != 0 {
		t.Errorf("expected no roles, got %v", roles)
	}
	if len(scopes) != 0 {
		t.Errorf("expected no scopes, got %v", scopes)
	}
}

func TestLoadUserScopes_Superadmin(t *testing.T) {
	drv := setupTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, drv, "superadmin_user")

	// Assign superadmin role.
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx.AssignRole(ctx, user.ID, "role_superadmin", ""); err != nil {
		_ = tx.Rollback()
		t.Fatalf("AssignRole: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	roles, scopes, err := auth.LoadUserScopes(ctx, drv, user.ID)
	if err != nil {
		t.Fatalf("LoadUserScopes: %v", err)
	}

	if len(roles) != 1 || roles[0] != "superadmin" {
		t.Errorf("expected roles=[superadmin], got %v", roles)
	}

	// Superadmin has the "*" wildcard scope.
	found := false
	for _, s := range scopes {
		if s == "*" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected '*' scope for superadmin, got %v", scopes)
	}
}

func TestLoadUserScopes_MultipleRoles(t *testing.T) {
	drv := setupTestStore(t)
	ctx := context.Background()

	user := createTestUser(t, drv, "multirole_user")

	// Assign both viewer and operator roles.
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx.AssignRole(ctx, user.ID, "role_viewer", ""); err != nil {
		_ = tx.Rollback()
		t.Fatalf("AssignRole viewer: %v", err)
	}
	if err := tx.AssignRole(ctx, user.ID, "role_operator", ""); err != nil {
		_ = tx.Rollback()
		t.Fatalf("AssignRole operator: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	roles, scopes, err := auth.LoadUserScopes(ctx, drv, user.ID)
	if err != nil {
		t.Fatalf("LoadUserScopes: %v", err)
	}

	if len(roles) != 2 {
		t.Errorf("expected 2 roles, got %d: %v", len(roles), roles)
	}

	// Operator adds config:*, keys:own beyond viewer's set. Scopes should
	// be deduplicated from both roles combined.
	if len(scopes) < 6 {
		t.Errorf("expected at least 6 scopes for viewer+operator, got %d: %v", len(scopes), scopes)
	}
}
