package grpc

import (
	"context"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/version"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// newTestHealthService returns a healthService backed by a fresh SQLite store
// with migrations applied and a nil caddy manager.
func newTestHealthService(t *testing.T) (*healthService, store.Driver) {
	t.Helper()
	ctx := context.Background()

	d, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	svc := newHealthService(d, nil)
	return svc, d
}

// ---------------------------------------------------------------------------
// GetHealth tests
// ---------------------------------------------------------------------------

func TestHealthService_GetHealth_StoreOK_CaddyNil(t *testing.T) {
	svc, _ := newTestHealthService(t)
	ctx := context.Background()

	resp, err := svc.GetHealth(ctx, &riokuv1.HealthRequest{})
	if err != nil {
		t.Fatalf("GetHealth returned error: %v", err)
	}

	// Store should be OK.
	if resp.Store == nil {
		t.Fatal("Store subsystem is nil")
	}
	if resp.Store.State != riokuv1.HealthState_HEALTH_STATE_OK {
		t.Errorf("Store.State = %v, want OK", resp.Store.State)
	}

	// Caddy should be UNHEALTHY with "not running" message.
	if resp.Caddy == nil {
		t.Fatal("Caddy subsystem is nil")
	}
	if resp.Caddy.State != riokuv1.HealthState_HEALTH_STATE_UNHEALTHY {
		t.Errorf("Caddy.State = %v, want UNHEALTHY", resp.Caddy.State)
	}
	if resp.Caddy.Message != "not running" {
		t.Errorf("Caddy.Message = %q, want %q", resp.Caddy.Message, "not running")
	}

	// Overall should be DEGRADED because caddy is not running.
	if resp.Overall != riokuv1.HealthState_HEALTH_STATE_DEGRADED {
		t.Errorf("Overall = %v, want DEGRADED", resp.Overall)
	}

	// Version must be non-empty.
	if resp.Version == "" {
		t.Error("Version is empty")
	}

	// CheckedAt must be set.
	if resp.CheckedAt == nil {
		t.Error("CheckedAt is nil")
	}
}

func TestHealthService_GetHealth_StoreOK_CaddyNotRunning(t *testing.T) {
	svc, _ := newTestHealthService(t)

	// Replace nil manager with one that is not started (IsRunning = false).
	mgr := caddy.NewManager(caddy.ManagerConfig{Binary: "caddy", AdminAddr: "localhost:2019"}, slog.Default())
	svc.caddyMgr = mgr

	ctx := context.Background()
	resp, err := svc.GetHealth(ctx, &riokuv1.HealthRequest{})
	if err != nil {
		t.Fatalf("GetHealth returned error: %v", err)
	}

	if resp.Store.State != riokuv1.HealthState_HEALTH_STATE_OK {
		t.Errorf("Store.State = %v, want OK", resp.Store.State)
	}
	if resp.Caddy.State != riokuv1.HealthState_HEALTH_STATE_UNHEALTHY {
		t.Errorf("Caddy.State = %v, want UNHEALTHY", resp.Caddy.State)
	}
	if resp.Caddy.Message != "not running" {
		t.Errorf("Caddy.Message = %q, want %q", resp.Caddy.Message, "not running")
	}
	if resp.Overall != riokuv1.HealthState_HEALTH_STATE_DEGRADED {
		t.Errorf("Overall = %v, want DEGRADED", resp.Overall)
	}
}

func TestHealthService_GetHealth_StoreUnhealthy(t *testing.T) {
	ctx := context.Background()

	// Create a store without a t.Cleanup so we can close it ourselves without
	// a double-close panic.
	d, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	svc := newHealthService(d, nil)

	// Close the underlying store so that Health() returns !OK.
	if err := d.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	resp, err := svc.GetHealth(ctx, &riokuv1.HealthRequest{})
	if err != nil {
		t.Fatalf("GetHealth returned error: %v", err)
	}

	// Store should report UNHEALTHY after the connection is closed.
	if resp.Store.State != riokuv1.HealthState_HEALTH_STATE_UNHEALTHY {
		t.Errorf("Store.State = %v, want UNHEALTHY", resp.Store.State)
	}

	// Overall must be DEGRADED (at minimum) when store is unhealthy.
	if resp.Overall == riokuv1.HealthState_HEALTH_STATE_OK {
		t.Errorf("Overall = OK but store is unhealthy; expected DEGRADED or UNHEALTHY")
	}
}

func TestHealthService_GetHealth_Version(t *testing.T) {
	svc, _ := newTestHealthService(t)
	ctx := context.Background()

	resp, err := svc.GetHealth(ctx, &riokuv1.HealthRequest{})
	if err != nil {
		t.Fatalf("GetHealth returned error: %v", err)
	}

	if resp.Version != version.Version {
		t.Errorf("Version = %q, want %q", resp.Version, version.Version)
	}
}

// ---------------------------------------------------------------------------
// GetCaddyStatus tests
// ---------------------------------------------------------------------------

func TestHealthService_GetCaddyStatus_NilManager(t *testing.T) {
	svc, _ := newTestHealthService(t) // nil caddy manager
	ctx := context.Background()

	resp, err := svc.GetCaddyStatus(ctx, &riokuv1.CaddyStatusRequest{})
	if err != nil {
		t.Fatalf("GetCaddyStatus returned error: %v", err)
	}

	if resp.Running {
		t.Error("Running = true, want false for nil manager")
	}
	if resp.State != riokuv1.HealthState_HEALTH_STATE_UNHEALTHY {
		t.Errorf("State = %v, want UNHEALTHY", resp.State)
	}
	if resp.CheckedAt == nil {
		t.Error("CheckedAt is nil")
	}
}

func TestHealthService_GetCaddyStatus_NotRunning(t *testing.T) {
	svc, _ := newTestHealthService(t)

	// Attach a manager that has never been started (IsRunning = false).
	mgr := caddy.NewManager(caddy.ManagerConfig{Binary: "caddy", AdminAddr: "localhost:2019"}, slog.Default())
	svc.caddyMgr = mgr

	ctx := context.Background()
	resp, err := svc.GetCaddyStatus(ctx, &riokuv1.CaddyStatusRequest{})
	if err != nil {
		t.Fatalf("GetCaddyStatus returned error: %v", err)
	}

	if resp.Running {
		t.Error("Running = true, want false when manager not started")
	}
	if resp.State != riokuv1.HealthState_HEALTH_STATE_UNHEALTHY {
		t.Errorf("State = %v, want UNHEALTHY", resp.State)
	}
}
