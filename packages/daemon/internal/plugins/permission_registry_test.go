package plugins_test

import (
	"context"
	"errors"
	"testing"

	"github.com/riokulabs/rioku/internal/plugins"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// openSQLite opens a fresh sqlite driver in t.TempDir() and runs all
// migrations so built-in permissions are seeded.
func openSQLite(t *testing.T) store.Driver {
	t.Helper()
	ctx := context.Background()
	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	if err := drv.Open(ctx, store.DriverConfig{Path: t.TempDir() + "/permreg.db"}); err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return drv
}

// TestPermissionRegistry_RegisterAndUnregister covers the canonical
// install → uninstall lifecycle.
func TestPermissionRegistry_RegisterAndUnregister(t *testing.T) {
	drv := openSQLite(t)
	ctx := context.Background()

	pluginID := "plugin-acme-billing"
	declared := []string{"acme-billing:read", "acme-billing:write"}

	if err := plugins.Register(ctx, drv, pluginID, declared); err != nil {
		t.Fatalf("Register: %v", err)
	}

	// The catalog should now contain both rows with source=plugin-manifest.
	tx, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	allPerms, err := tx.ListPermissions(ctx)
	_ = tx.Rollback()
	if err != nil {
		t.Fatalf("ListPermissions: %v", err)
	}
	got := map[string]*store.Permission{}
	for _, p := range allPerms {
		got[p.ID] = p
	}
	for _, id := range declared {
		row, ok := got[id]
		if !ok {
			t.Fatalf("expected catalog to contain %q after Register", id)
		}
		if row.Source != "plugin-manifest" {
			t.Fatalf("%q: source=%q, want plugin-manifest", id, row.Source)
		}
		if row.SourcePluginID != pluginID {
			t.Fatalf("%q: source_plugin_id=%q, want %q", id, row.SourcePluginID, pluginID)
		}
	}

	// Unregister should remove exactly the two rows.
	n, err := plugins.Unregister(ctx, drv, pluginID)
	if err != nil {
		t.Fatalf("Unregister: %v", err)
	}
	if n != len(declared) {
		t.Fatalf("Unregister returned n=%d, want %d", n, len(declared))
	}

	tx, _ = drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	allAfter, _ := tx.ListPermissions(ctx)
	_ = tx.Rollback()
	for _, p := range allAfter {
		if p.SourcePluginID == pluginID {
			t.Fatalf("expected no rows for plugin %q after Unregister, got %q", pluginID, p.ID)
		}
	}
}

// TestPermissionRegistry_RegisterIdempotent ensures re-registering
// the same plugin's perms doesn't error and leaves the catalog stable.
func TestPermissionRegistry_RegisterIdempotent(t *testing.T) {
	drv := openSQLite(t)
	ctx := context.Background()
	pluginID := "plugin-idem"
	declared := []string{"idem:read"}

	if err := plugins.Register(ctx, drv, pluginID, declared); err != nil {
		t.Fatalf("Register #1: %v", err)
	}
	if err := plugins.Register(ctx, drv, pluginID, declared); err != nil {
		t.Fatalf("Register #2 (re-install): %v", err)
	}

	// The Unregister on a fresh plugin id is a no-op.
	n, err := plugins.Unregister(ctx, drv, "plugin-never-registered")
	if err != nil {
		t.Fatalf("Unregister never-registered: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected n=0, got %d", n)
	}
}

// TestPermissionRegistry_ConflictWithBuiltIn registers an id that
// collides with a built-in perm; the registry must surface
// ErrPermissionConflict.
func TestPermissionRegistry_ConflictWithBuiltIn(t *testing.T) {
	drv := openSQLite(t)
	ctx := context.Background()

	// `plugin:install` is a built-in permission seeded by the
	// migrations. A plugin trying to claim it must be rejected.
	err := plugins.Register(ctx, drv, "plugin-evil", []string{"plugin:install"})
	if !errors.Is(err, store.ErrPermissionConflict) {
		t.Fatalf("expected ErrPermissionConflict, got %v", err)
	}
}

// TestPermissionRegistry_InvalidID rejects empty / malformed ids.
func TestPermissionRegistry_InvalidID(t *testing.T) {
	drv := openSQLite(t)
	ctx := context.Background()

	// All-empty input is a no-op.
	if err := plugins.Register(ctx, drv, "p1", []string{"", "  "}); err != nil {
		t.Fatalf("Register with empty perms should be a no-op, got %v", err)
	}

	// A pluginID is required.
	if err := plugins.Register(ctx, drv, "", []string{"x:y"}); err == nil {
		t.Fatalf("expected error for empty pluginID")
	}
	if _, err := plugins.Unregister(ctx, drv, ""); err == nil {
		t.Fatalf("expected error for empty pluginID")
	}
}

// TestBuildPermissionRows_ResourceActionParsing exercises the
// resource:action parser including the "bare resource" fallback.
func TestBuildPermissionRows_ResourceActionParsing(t *testing.T) {
	rows, err := plugins.BuildPermissionRows([]string{"foo:bar", "baz", "  spaces:trimmed  ", "foo:bar"})
	if err != nil {
		t.Fatalf("BuildPermissionRows: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected 3 deduped rows, got %d", len(rows))
	}
	want := map[string][2]string{
		"foo:bar":         {"foo", "bar"},
		"baz":             {"baz", "*"},
		"spaces:trimmed":  {"spaces", "trimmed"},
	}
	for _, r := range rows {
		w, ok := want[r.ID]
		if !ok {
			t.Fatalf("unexpected id %q", r.ID)
		}
		if r.Resource != w[0] || r.Action != w[1] {
			t.Fatalf("%q: got (%q,%q), want (%q,%q)", r.ID, r.Resource, r.Action, w[0], w[1])
		}
	}
}
