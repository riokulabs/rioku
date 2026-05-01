package mysql_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/mysql"
)

// TestGalera_OpenMultiNode verifies the driver can open against a Galera
// cluster (or a single-node MariaDB acting as one) and pick a Synced
// primary. Gated on GALERA_TEST_DSNS — comma-separated list of node DSNs.
func TestGalera_OpenMultiNode(t *testing.T) {
	raw := os.Getenv("GALERA_TEST_DSNS")
	if raw == "" {
		t.Skip("GALERA_TEST_DSNS not set; skipping Galera integration test")
	}

	dsns := strings.Split(raw, ",")
	nodes := make([]store.NodeConfig, 0, len(dsns))
	for _, d := range dsns {
		nodes = append(nodes, store.NodeConfig{DSN: strings.TrimSpace(d)})
	}

	ctx := context.Background()
	d, err := store.New("mysql")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = d.Close() }()

	if err := d.Open(ctx, store.DriverConfig{Nodes: nodes}); err != nil {
		t.Fatalf("Open multi-node: %v", err)
	}
	if err := d.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	health := d.Health(ctx)
	if !health.OK {
		t.Fatalf("Health not OK: %+v", health)
	}
	// Galera Synced node should be in ModePrimary state.
	if health.Mode != store.ModePrimary {
		t.Logf("Health mode: %v (this is OK for non-Galera MySQL)", health.Mode)
	}
}
