package cli

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	// Register the SQLite driver.
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// openSQLiteStore opens a temporary SQLite store for testing.
func openSQLiteStore(t *testing.T, dir, name string) store.Driver {
	t.Helper()

	dbPath := filepath.Join(dir, name+".db")
	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("store.New(sqlite): %v", err)
	}

	ctx := context.Background()
	if err := drv.Open(ctx, store.DriverConfig{Driver: "sqlite", Path: dbPath}); err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("migrate up: %v", err)
	}
	return drv
}

func TestTransferData(t *testing.T) {
	dir := t.TempDir()

	source := openSQLiteStore(t, dir, "source")
	defer func() { _ = source.Close() }()

	target := openSQLiteStore(t, dir, "target")
	defer func() { _ = target.Close() }()

	ctx := context.Background()

	// Seed source with test data.
	srcTx, err := source.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("begin source tx: %v", err)
	}

	svc, err := srcTx.CreateService(ctx, &riokuv1.Service{
		Name: "test-svc",
		Upstreams: []*riokuv1.Upstream{
			{Address: "127.0.0.1:8080"},
		},
	})
	if err != nil {
		t.Fatalf("create service: %v", err)
	}

	_, err = srcTx.CreateRoute(ctx, &riokuv1.Route{
		Name:    "test-route",
		Target:  &riokuv1.Route_ServiceId{ServiceId: svc.GetId()},
		Enabled: true,
		Matchers: []*riokuv1.Matcher{
			{Hosts: []string{"test.local"}},
		},
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}

	if err := srcTx.Commit(); err != nil {
		t.Fatalf("commit source: %v", err)
	}

	// Redirect stdout to discard transfer output.
	oldStdout := os.Stdout
	os.Stdout, _ = os.Open(os.DevNull)
	defer func() { os.Stdout = oldStdout }()

	// Run transfer.
	if err := transferData(ctx, source, target); err != nil {
		t.Fatalf("transferData: %v", err)
	}

	// Verify target has the data.
	dstTx, err := target.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("begin target tx: %v", err)
	}
	defer func() { _ = dstTx.Rollback() }()

	services, err := dstTx.ListServices(ctx)
	if err != nil {
		t.Fatalf("list target services: %v", err)
	}
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	if services[0].GetName() != "test-svc" {
		t.Errorf("expected service name 'test-svc', got %q", services[0].GetName())
	}

	routes, err := dstTx.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("list target routes: %v", err)
	}
	if len(routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(routes))
	}
	if routes[0].GetName() != "test-route" {
		t.Errorf("expected route name 'test-route', got %q", routes[0].GetName())
	}
}

func TestMigrateStatusCmd(t *testing.T) {
	cmd := newMigrateCmd()
	if cmd.Use != "migrate" {
		t.Errorf("expected 'migrate', got %q", cmd.Use)
	}

	// Verify subcommands exist.
	subs := make(map[string]bool)
	for _, sub := range cmd.Commands() {
		subs[sub.Use] = true
	}
	for _, expected := range []string{"verify", "run", "status"} {
		if !subs[expected] {
			t.Errorf("missing subcommand %q", expected)
		}
	}
}
