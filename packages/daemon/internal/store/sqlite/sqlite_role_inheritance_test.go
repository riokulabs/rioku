package sqlite_test

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// TestRoleInheritance_RoundTripPersistsParent confirms parent_role_id
// survives a CreateRole + GetRole cycle via the actual SQLite driver.
func TestRoleInheritance_RoundTripPersistsParent(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	tx := beginTx(t, d, ctx)
	defer tx.Rollback() //nolint:errcheck

	parentID := "role_test_parent_" + uuid.NewString()
	if _, err := tx.CreateRole(ctx, store.CreateRoleParams{
		ID:          parentID,
		Name:        "test-parent-" + uuid.NewString(),
		Description: "parent role",
		Permissions: []string{"config:read"},
	}); err != nil {
		t.Fatalf("CreateRole parent: %v", err)
	}

	childID := "role_test_child_" + uuid.NewString()
	if _, err := tx.CreateRole(ctx, store.CreateRoleParams{
		ID:           childID,
		Name:         "test-child-" + uuid.NewString(),
		Description:  "child role",
		Permissions:  []string{"config:write"},
		ParentRoleID: &parentID,
	}); err != nil {
		t.Fatalf("CreateRole child: %v", err)
	}

	got, err := tx.GetRole(ctx, childID)
	if err != nil {
		t.Fatalf("GetRole: %v", err)
	}
	if got.ParentRoleID == nil || *got.ParentRoleID != parentID {
		t.Fatalf("ParentRoleID = %v, want %q", got.ParentRoleID, parentID)
	}
}

// TestRoleInheritance_EffectivePermissionsAggregates exercises the
// driver's EffectivePermissions Tx method against a real chain.
func TestRoleInheritance_EffectivePermissionsAggregates(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	tx := beginTx(t, d, ctx)
	defer tx.Rollback() //nolint:errcheck

	parentID := "role_test_parent_" + uuid.NewString()
	childID := "role_test_child_" + uuid.NewString()

	if _, err := tx.CreateRole(ctx, store.CreateRoleParams{
		ID:          parentID,
		Name:        "p-" + uuid.NewString(),
		Description: "p",
		Permissions: []string{"config:read"},
	}); err != nil {
		t.Fatalf("CreateRole parent: %v", err)
	}
	if _, err := tx.CreateRole(ctx, store.CreateRoleParams{
		ID:           childID,
		Name:         "c-" + uuid.NewString(),
		Description:  "c",
		Permissions:  []string{"config:write"},
		ParentRoleID: &parentID,
	}); err != nil {
		t.Fatalf("CreateRole child: %v", err)
	}

	got, err := tx.EffectivePermissions(ctx, childID)
	if err != nil {
		t.Fatalf("EffectivePermissions: %v", err)
	}
	want := []string{"config:read", "config:write"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("EffectivePermissions = %v, want %v", got, want)
	}
}

// TestRoleInheritance_CycleRejectedAtResolve verifies the Tx method
// returns ErrRoleCycle when a chain is mutated into a cycle. The
// store doesn't currently reject cycle-creating UPDATE statements at
// schema level — the resolver is the enforcement point.
func TestRoleInheritance_CycleRejectedAtResolve(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	tx := beginTx(t, d, ctx)
	defer tx.Rollback() //nolint:errcheck

	aID := "role_a_" + uuid.NewString()
	bID := "role_b_" + uuid.NewString()

	// a and b are created without parents first.
	if _, err := tx.CreateRole(ctx, store.CreateRoleParams{
		ID: aID, Name: "a-" + uuid.NewString(), Description: "a",
		Permissions: []string{"config:read"},
	}); err != nil {
		t.Fatalf("CreateRole a: %v", err)
	}
	if _, err := tx.CreateRole(ctx, store.CreateRoleParams{
		ID: bID, Name: "b-" + uuid.NewString(), Description: "b",
		Permissions: []string{"config:write"},
	}); err != nil {
		t.Fatalf("CreateRole b: %v", err)
	}
	// Then we link them: a -> b -> a.
	if _, err := tx.UpdateRole(ctx, aID, store.UpdateRoleParams{ParentRoleID: &bID}); err != nil {
		t.Fatalf("UpdateRole a -> b: %v", err)
	}
	if _, err := tx.UpdateRole(ctx, bID, store.UpdateRoleParams{ParentRoleID: &aID}); err != nil {
		t.Fatalf("UpdateRole b -> a: %v", err)
	}

	_, err := tx.EffectivePermissions(ctx, aID)
	if !errors.Is(err, store.ErrRoleCycle) {
		t.Fatalf("err = %v, want wrap ErrRoleCycle", err)
	}
}

// TestRoleInheritance_ClearParent verifies UpdateRoleParams.ClearParent
// actually nulls the column (vs. ParentRoleID==nil meaning "no change").
func TestRoleInheritance_ClearParent(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	tx := beginTx(t, d, ctx)
	defer tx.Rollback() //nolint:errcheck

	parentID := "role_p_" + uuid.NewString()
	childID := "role_c_" + uuid.NewString()
	if _, err := tx.CreateRole(ctx, store.CreateRoleParams{
		ID: parentID, Name: "p-" + uuid.NewString(), Description: "p",
		Permissions: []string{"config:read"},
	}); err != nil {
		t.Fatalf("CreateRole parent: %v", err)
	}
	if _, err := tx.CreateRole(ctx, store.CreateRoleParams{
		ID: childID, Name: "c-" + uuid.NewString(), Description: "c",
		Permissions:  []string{"config:write"},
		ParentRoleID: &parentID,
	}); err != nil {
		t.Fatalf("CreateRole child: %v", err)
	}

	if _, err := tx.UpdateRole(ctx, childID, store.UpdateRoleParams{ClearParent: true}); err != nil {
		t.Fatalf("UpdateRole ClearParent: %v", err)
	}

	got, err := tx.GetRole(ctx, childID)
	if err != nil {
		t.Fatalf("GetRole: %v", err)
	}
	if got.ParentRoleID != nil {
		t.Fatalf("ParentRoleID = %v, want nil after ClearParent", got.ParentRoleID)
	}
}

// --- helpers ---

func openTempStore(t *testing.T) (store.Driver, func()) {
	t.Helper()
	d, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	// Use a per-test temp file rather than :memory: so transactions
	// can see committed state across goroutines / connections.
	dbPath := t.TempDir() + "/test.db"
	if err := d.Open(context.Background(), store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := d.Migrate(context.Background(), store.MigrateUp); err != nil {
		_ = d.Close()
		t.Fatalf("Migrate: %v", err)
	}
	return d, func() { _ = d.Close() }
}

func tenantCtx(_ *testing.T) context.Context {
	return store.WithTenantID(context.Background(), "tenant_default")
}

func beginTx(t *testing.T, d store.Driver, ctx context.Context) store.Tx {
	t.Helper()
	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	return tx
}
