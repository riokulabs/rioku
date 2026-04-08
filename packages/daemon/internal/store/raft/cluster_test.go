package raft

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Rejoin after partition
// ---------------------------------------------------------------------------

func TestClusterRejoinAfterPartition(t *testing.T) {
	c := newTestCluster(t, 3)
	c.start()
	defer c.stop()

	ctx := context.Background()

	// Write initial data via the leader.
	leaderIdx, leaderNode := c.leader()
	tx, err := leaderNode.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	route1, err := tx.CreateRoute(ctx, &riokuv1.Route{
		Name:    "before-partition",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	tx.Commit()

	time.Sleep(500 * time.Millisecond) // replication

	// Partition: close one follower.
	var partitionedIdx int
	for i := range c.nodes {
		if i != leaderIdx {
			partitionedIdx = i
			break
		}
	}
	t.Logf("partitioning node-%d", partitionedIdx)
	if err := c.nodes[partitionedIdx].Close(); err != nil {
		t.Logf("close partitioned node: %v", err)
	}

	// Write more data while node is partitioned.
	tx2, err := leaderNode.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	route2, err := tx2.CreateRoute(ctx, &riokuv1.Route{
		Name:    "during-partition",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("create route during partition: %v", err)
	}
	tx2.Commit()

	time.Sleep(500 * time.Millisecond)

	// Rejoin the partitioned node.
	t.Logf("rejoining node-%d", partitionedIdx)
	dir := c.dirs[partitionedIdx]
	rejoined := &Driver{}
	addr := fmt.Sprintf("127.0.0.1:%d", c.basePort+partitionedIdx)
	rejoined.SetRaftConfig(RaftConfig{
		NodeID:        fmt.Sprintf("node-%d", partitionedIdx),
		DataDir:       filepath.Join(dir, "data"),
		BindAddr:      addr,
		AdvertiseAddr: addr,
		Bootstrap:     false,
	})
	if err := rejoined.Open(ctx, store.DriverConfig{}); err != nil {
		t.Fatalf("reopen partitioned node: %v", err)
	}
	c.nodes[partitionedIdx] = rejoined

	// Wait for log replication to catch up.
	time.Sleep(2 * time.Second)

	// Verify the rejoined node has all data.
	rtx, err := rejoined.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("begin read on rejoined node: %v", err)
	}
	routes, err := rtx.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("list routes on rejoined node: %v", err)
	}
	rtx.Rollback()

	if len(routes) != 2 {
		t.Fatalf("rejoined node: expected 2 routes, got %d", len(routes))
	}

	// Verify by name.
	names := map[string]bool{}
	for _, r := range routes {
		names[r.GetName()] = true
	}
	if !names["before-partition"] {
		t.Error("missing route 'before-partition'")
	}
	if !names["during-partition"] {
		t.Error("missing route 'during-partition'")
	}

	_ = route1
	_ = route2
}

// ---------------------------------------------------------------------------
// Snapshot and restore
// ---------------------------------------------------------------------------

func TestClusterSnapshotAndRestore(t *testing.T) {
	c := newTestCluster(t, 3)
	c.start()
	defer c.stop()

	ctx := context.Background()

	_, leaderNode := c.leader()

	// Write 100 routes to generate enough log for snapshot to matter.
	for i := 0; i < 100; i++ {
		tx, err := leaderNode.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("begin route %d: %v", i, err)
		}
		_, err = tx.CreateRoute(ctx, &riokuv1.Route{
			Name:    fmt.Sprintf("snapshot-route-%d", i),
			Enabled: true,
		})
		if err != nil {
			t.Fatalf("create route %d: %v", i, err)
		}
		tx.Commit()
	}

	time.Sleep(1 * time.Second) // replication

	// Trigger a snapshot on the leader.
	future := leaderNode.raft.Snapshot()
	if err := future.Error(); err != nil {
		t.Fatalf("snapshot: %v", err)
	}

	// Pick a follower, close it, and delete its data directory.
	leaderIdx, _ := c.leader()
	var followerIdx int
	for i := range c.nodes {
		if i != leaderIdx {
			followerIdx = i
			break
		}
	}

	t.Logf("destroying data for node-%d", followerIdx)
	if err := c.nodes[followerIdx].Close(); err != nil {
		t.Logf("close follower: %v", err)
	}

	dataDir := filepath.Join(c.dirs[followerIdx], "data")
	if err := os.RemoveAll(dataDir); err != nil {
		t.Fatalf("remove data dir: %v", err)
	}

	// Restart the follower. It should recover from snapshot.
	restored := &Driver{}
	addr := fmt.Sprintf("127.0.0.1:%d", c.basePort+followerIdx)
	restored.SetRaftConfig(RaftConfig{
		NodeID:        fmt.Sprintf("node-%d", followerIdx),
		DataDir:       dataDir,
		BindAddr:      addr,
		AdvertiseAddr: addr,
		Bootstrap:     false,
	})
	if err := restored.Open(ctx, store.DriverConfig{}); err != nil {
		t.Fatalf("reopen follower: %v", err)
	}
	c.nodes[followerIdx] = restored

	// Wait for snapshot restore + replication.
	time.Sleep(3 * time.Second)

	// Verify the restored node has all 100 routes.
	rtx, err := restored.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("begin read on restored node: %v", err)
	}
	routes, err := rtx.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("list routes on restored node: %v", err)
	}
	rtx.Rollback()

	if len(routes) != 100 {
		t.Fatalf("restored node: expected 100 routes, got %d", len(routes))
	}
}

// ---------------------------------------------------------------------------
// Store interface parity — exercise implemented CRUD through raft driver
// ---------------------------------------------------------------------------

func TestClusterStoreInterfaceParity(t *testing.T) {
	c := newTestCluster(t, 1)
	c.start()
	defer c.stop()

	ctx := context.Background()
	_, node := c.leader()

	// --- Route CRUD ---
	t.Run("route_crud", func(t *testing.T) {
		tx, _ := node.Begin(ctx, store.TxOptions{})
		route, err := tx.CreateRoute(ctx, &riokuv1.Route{
			Name:    "parity-route",
			Enabled: true,
		})
		if err != nil {
			t.Fatalf("create route: %v", err)
		}
		tx.Commit()

		if route.GetId() == "" {
			t.Fatal("expected non-empty route ID")
		}
		if route.GetName() != "parity-route" {
			t.Errorf("name=%q, want %q", route.GetName(), "parity-route")
		}

		// Get.
		rtx, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		got, err := rtx.GetRoute(ctx, route.GetId())
		if err != nil {
			t.Fatalf("get route: %v", err)
		}
		if got.GetName() != "parity-route" {
			t.Errorf("got name=%q, want %q", got.GetName(), "parity-route")
		}
		rtx.Rollback()

		// Update.
		tx2, _ := node.Begin(ctx, store.TxOptions{})
		route.Name = "parity-route-updated"
		updated, err := tx2.UpdateRoute(ctx, route)
		if err != nil {
			t.Fatalf("update route: %v", err)
		}
		if updated.GetName() != "parity-route-updated" {
			t.Errorf("name=%q, want %q", updated.GetName(), "parity-route-updated")
		}
		tx2.Commit()

		// Delete.
		dtx, _ := node.Begin(ctx, store.TxOptions{})
		if err := dtx.DeleteRoute(ctx, route.GetId()); err != nil {
			t.Fatalf("delete route: %v", err)
		}
		dtx.Commit()

		// Verify deleted.
		rtx2, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		_, err = rtx2.GetRoute(ctx, route.GetId())
		rtx2.Rollback()
		if err == nil {
			t.Error("expected error getting deleted route")
		}
	})

	// --- Service CRUD ---
	t.Run("service_crud", func(t *testing.T) {
		tx, _ := node.Begin(ctx, store.TxOptions{})
		svc, err := tx.CreateService(ctx, &riokuv1.Service{
			Name: "parity-service",
			Upstreams: []*riokuv1.Upstream{
				{Address: "127.0.0.1:8080", Weight: 100},
			},
		})
		if err != nil {
			t.Fatalf("create service: %v", err)
		}
		tx.Commit()

		if svc.GetId() == "" {
			t.Fatal("expected non-empty service ID")
		}
		if svc.GetName() != "parity-service" {
			t.Errorf("name=%q, want %q", svc.GetName(), "parity-service")
		}

		// Get.
		rtx, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		got, err := rtx.GetService(ctx, svc.GetId())
		if err != nil {
			t.Fatalf("get service: %v", err)
		}
		if got.GetName() != "parity-service" {
			t.Errorf("got name=%q, want %q", got.GetName(), "parity-service")
		}
		rtx.Rollback()

		// List.
		ltx, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		services, err := ltx.ListServices(ctx)
		if err != nil {
			t.Fatalf("list services: %v", err)
		}
		ltx.Rollback()

		found := false
		for _, s := range services {
			if s.GetId() == svc.GetId() {
				found = true
				break
			}
		}
		if !found {
			t.Error("created service not found in list")
		}

		// Delete.
		dtx, _ := node.Begin(ctx, store.TxOptions{})
		if err := dtx.DeleteService(ctx, svc.GetId()); err != nil {
			t.Fatalf("delete service: %v", err)
		}
		dtx.Commit()

		// Verify deleted.
		rtx2, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		_, err = rtx2.GetService(ctx, svc.GetId())
		rtx2.Rollback()
		if err == nil {
			t.Error("expected error getting deleted service")
		}
	})

	// --- Policy CRUD ---
	t.Run("policy_crud", func(t *testing.T) {
		tx, _ := node.Begin(ctx, store.TxOptions{})
		pol, err := tx.CreatePolicy(ctx, &riokuv1.Policy{
			Name: "parity-policy",
			Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
		})
		if err != nil {
			t.Fatalf("create policy: %v", err)
		}
		tx.Commit()

		if pol.GetId() == "" {
			t.Fatal("expected non-empty policy ID")
		}

		// Get.
		rtx, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		got, err := rtx.GetPolicy(ctx, pol.GetId())
		if err != nil {
			t.Fatalf("get policy: %v", err)
		}
		if got.GetName() != "parity-policy" {
			t.Errorf("got name=%q, want %q", got.GetName(), "parity-policy")
		}
		rtx.Rollback()

		// Update.
		tx2, _ := node.Begin(ctx, store.TxOptions{})
		pol.Name = "parity-policy-updated"
		updated, err := tx2.UpdatePolicy(ctx, pol)
		if err != nil {
			t.Fatalf("update policy: %v", err)
		}
		if updated.GetName() != "parity-policy-updated" {
			t.Errorf("name=%q, want %q", updated.GetName(), "parity-policy-updated")
		}
		tx2.Commit()

		// Delete.
		dtx, _ := node.Begin(ctx, store.TxOptions{})
		if err := dtx.DeletePolicy(ctx, pol.GetId()); err != nil {
			t.Fatalf("delete policy: %v", err)
		}
		dtx.Commit()
	})

	// --- API Key CRUD ---
	t.Run("apikey_crud", func(t *testing.T) {
		tx, _ := node.Begin(ctx, store.TxOptions{})
		keyHash := "sha256:parity-test-hash-abcdef1234567890"
		keyID, err := tx.CreateAPIKey(ctx, "parity-key", keyHash, []string{"read", "write"}, nil)
		if err != nil {
			t.Fatalf("create api key: %v", err)
		}
		tx.Commit()

		if keyID == "" {
			t.Fatal("expected non-empty key ID")
		}

		// Get by ID.
		rtx, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		got, err := rtx.GetAPIKey(ctx, keyID)
		if err != nil {
			t.Fatalf("get api key: %v", err)
		}
		if got.Name != "parity-key" {
			t.Errorf("name=%q, want %q", got.Name, "parity-key")
		}
		rtx.Rollback()

		// Get by hash.
		rtx2, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		gotByHash, err := rtx2.GetAPIKeyByHash(ctx, keyHash)
		if err != nil {
			t.Fatalf("get api key by hash: %v", err)
		}
		if gotByHash.ID != keyID {
			t.Errorf("id=%q, want %q", gotByHash.ID, keyID)
		}
		rtx2.Rollback()

		// List.
		ltx, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		keys, err := ltx.ListAPIKeys(ctx)
		if err != nil {
			t.Fatalf("list api keys: %v", err)
		}
		ltx.Rollback()

		found := false
		for _, k := range keys {
			if k.ID == keyID {
				found = true
				break
			}
		}
		if !found {
			t.Error("created api key not found in list")
		}

		// Revoke.
		rvtx, _ := node.Begin(ctx, store.TxOptions{})
		if err := rvtx.RevokeAPIKey(ctx, keyID); err != nil {
			t.Fatalf("revoke api key: %v", err)
		}
		rvtx.Commit()

		// Verify revoked (not in active list).
		ltx2, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		keys2, err := ltx2.ListAPIKeys(ctx)
		if err != nil {
			t.Fatalf("list api keys after revoke: %v", err)
		}
		ltx2.Rollback()

		for _, k := range keys2 {
			if k.ID == keyID {
				t.Error("revoked key should not appear in active list")
			}
		}
	})

	// --- User CRUD (stubs — verify not-implemented errors) ---
	t.Run("user_stubs", func(t *testing.T) {
		tx, _ := node.Begin(ctx, store.TxOptions{})
		_, err := tx.CreateUser(ctx, &store.User{
			Username:     "stub-user",
			PasswordHash: "hash",
			Status:       "active",
		})
		if err == nil {
			t.Error("expected not-implemented error from CreateUser")
		}
		tx.Rollback()
	})
}
