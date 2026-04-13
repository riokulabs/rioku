package grpc

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/tracestore"

	_ "github.com/riokulabs/rioku/internal/store/sqlite"
	_ "github.com/riokulabs/rioku/internal/tracestore/sqlite"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// serverDeps holds all dependencies required to construct a gRPC Server.
type serverDeps struct {
	store      store.Driver
	traceStore tracestore.Driver
	auth       *auth.Auth
	engine     *config.Engine
}

// newServerDeps sets up a fully migrated SQLite store and trace store for tests.
func newServerDeps(t *testing.T) serverDeps {
	t.Helper()
	ctx := context.Background()

	// Config store.
	d, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open store: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("Migrate store: %v", err)
	}

	// Trace store.
	td, err := tracestore.New("sqlite")
	if err != nil {
		t.Fatalf("tracestore.New: %v", err)
	}
	tracePath := filepath.Join(t.TempDir(), "traces.db")
	if err := td.Open(ctx, tracestore.DriverConfig{Driver: "sqlite", Path: tracePath}); err != nil {
		t.Fatalf("Open tracestore: %v", err)
	}
	t.Cleanup(func() { _ = td.Close() })

	a := auth.NewAuth([]byte("test-key-32-bytes-long!!!!!!!!!!!"), d)
	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{}, "", nil, caddy.SecurityHeadersConfig{})
	engine := config.NewEngine(d, compiler)

	return serverDeps{
		store:      d,
		traceStore: td,
		auth:       a,
		engine:     engine,
	}
}

// ---------------------------------------------------------------------------
// NewServer tests
// ---------------------------------------------------------------------------

func TestNewServer(t *testing.T) {
	deps := newServerDeps(t)
	ring := tracestore.NewRingBuffer(256)

	srv, err := NewServer("localhost:0", deps.engine, deps.store, nil, deps.auth, ring, deps.traceStore)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	if srv == nil {
		t.Fatal("NewServer returned nil server")
	}
	t.Cleanup(func() { srv.Stop() })
}

func TestNewServer_NoAuth(t *testing.T) {
	deps := newServerDeps(t)

	// auth=nil is valid — interceptors should be omitted.
	srv, err := NewServer("localhost:0", deps.engine, deps.store, nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewServer (no auth): %v", err)
	}
	if srv == nil {
		t.Fatal("NewServer returned nil")
	}
	t.Cleanup(func() { srv.Stop() })
}

func TestNewServer_NoTraceStore(t *testing.T) {
	deps := newServerDeps(t)

	// traceBuf and traceStore both nil — TrafficService should not be registered.
	srv, err := NewServer("localhost:0", deps.engine, deps.store, nil, deps.auth, nil, nil)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	t.Cleanup(func() { srv.Stop() })

	if srv.TrafficService() != nil {
		t.Error("TrafficService should be nil when traceStore is not configured")
	}
}

// ---------------------------------------------------------------------------
// Service getter tests
// ---------------------------------------------------------------------------

func TestNewServer_ServiceGetters(t *testing.T) {
	deps := newServerDeps(t)
	ring := tracestore.NewRingBuffer(256)

	srv, err := NewServer("localhost:0", deps.engine, deps.store, nil, deps.auth, ring, deps.traceStore)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	t.Cleanup(func() { srv.Stop() })

	if srv.ConfigService() == nil {
		t.Error("ConfigService() returned nil")
	}
	if srv.HealthService() == nil {
		t.Error("HealthService() returned nil")
	}
	if srv.TrafficService() == nil {
		t.Error("TrafficService() returned nil when traceStore is configured")
	}
}

func TestNewServer_InvalidAddr(t *testing.T) {
	deps := newServerDeps(t)

	// An invalid address should cause net.Listen to fail.
	_, err := NewServer("invalid-addr-%%%", deps.engine, deps.store, nil, deps.auth, nil, nil)
	if err == nil {
		t.Fatal("expected error for invalid address, got nil")
	}
}
