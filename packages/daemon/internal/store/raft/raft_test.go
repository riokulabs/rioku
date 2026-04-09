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

// testCluster manages a set of in-process raft nodes for integration tests.
type testCluster struct {
	nodes    []*Driver
	dirs     []string
	t        *testing.T
	basePort int
}

func newTestCluster(t *testing.T, size int) *testCluster {
	t.Helper()
	c := &testCluster{
		t:        t,
		basePort: 17700 + (os.Getpid()%1000)*10,
	}

	for i := 0; i < size; i++ {
		dir := t.TempDir()
		c.dirs = append(c.dirs, dir)

		d := &Driver{}
		addr := fmt.Sprintf("127.0.0.1:%d", c.basePort+i)
		d.SetRaftConfig(RaftConfig{
			NodeID:        fmt.Sprintf("node-%d", i),
			DataDir:       filepath.Join(dir, "data"),
			BindAddr:      addr,
			AdvertiseAddr: addr,
			Bootstrap:     i == 0, // only first node bootstraps
		})
		c.nodes = append(c.nodes, d)
	}

	return c
}

func (c *testCluster) start() {
	c.t.Helper()
	ctx := context.Background()

	// Start the bootstrap node first.
	if err := c.nodes[0].Open(ctx, store.DriverConfig{}); err != nil {
		c.t.Fatalf("open node 0: %v", err)
	}

	// Wait for node 0 to become leader.
	c.waitForLeader(0, 10*time.Second)

	// Start and join remaining nodes.
	for i := 1; i < len(c.nodes); i++ {
		if err := c.nodes[i].Open(ctx, store.DriverConfig{}); err != nil {
			c.t.Fatalf("open node %d: %v", i, err)
		}

		// Add as voter via the leader.
		addr := fmt.Sprintf("127.0.0.1:%d", c.basePort+i)
		if err := c.nodes[0].AddVoter(fmt.Sprintf("node-%d", i), addr); err != nil {
			c.t.Fatalf("add voter %d: %v", i, err)
		}
	}

	// Wait for all nodes to settle.
	time.Sleep(500 * time.Millisecond)
}

func (c *testCluster) stop() {
	for i, n := range c.nodes {
		if err := n.Close(); err != nil {
			c.t.Logf("close node %d: %v", i, err)
		}
	}
}

func (c *testCluster) leader() (int, *Driver) {
	for i, n := range c.nodes {
		if n.IsLeader() {
			return i, n
		}
	}
	return -1, nil
}

func (c *testCluster) waitForLeader(nodeIdx int, timeout time.Duration) {
	c.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if c.nodes[nodeIdx].raft != nil && c.nodes[nodeIdx].IsLeader() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	c.t.Fatalf("node %d did not become leader within %v", nodeIdx, timeout)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestClusterBootstrapAndRoute(t *testing.T) {
	c := newTestCluster(t, 3)
	c.start()
	defer c.stop()

	ctx := context.Background()

	// Verify we have a leader.
	leaderIdx, leaderNode := c.leader()
	if leaderIdx < 0 {
		t.Fatal("no leader found")
	}
	t.Logf("leader is node-%d", leaderIdx)

	// Write a route via the leader.
	tx, err := leaderNode.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}

	route, err := tx.CreateRoute(ctx, &riokuv1.Route{
		Name:    "test-route",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	t.Logf("created route: id=%s name=%s", route.GetId(), route.GetName())

	// Wait for replication.
	time.Sleep(500 * time.Millisecond)

	// Read the route from all nodes.
	for i, node := range c.nodes {
		rtx, err := node.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatalf("begin read tx on node %d: %v", i, err)
		}
		got, err := rtx.GetRoute(ctx, route.GetId())
		if err != nil {
			t.Fatalf("get route on node %d: %v", i, err)
		}
		if got.GetName() != "test-route" {
			t.Errorf("node %d: expected name 'test-route', got %q", i, got.GetName())
		}
		_ = rtx.Rollback()
	}
}

func TestLeaderFailover(t *testing.T) {
	c := newTestCluster(t, 3)
	c.start()
	defer c.stop()

	ctx := context.Background()

	// Write initial data.
	leaderIdx, leaderNode := c.leader()
	tx, err := leaderNode.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	_, err = tx.CreateRoute(ctx, &riokuv1.Route{
		Name:    "before-failover",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// Wait for replication.
	time.Sleep(500 * time.Millisecond)

	// Kill the leader.
	t.Logf("killing leader node-%d", leaderIdx)
	if err := c.nodes[leaderIdx].Close(); err != nil {
		t.Logf("close leader: %v", err)
	}

	// Wait for new leader election.
	newLeaderIdx := -1
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		for i, n := range c.nodes {
			if i == leaderIdx {
				continue // skip the killed node
			}
			if n.raft != nil && n.IsLeader() {
				newLeaderIdx = i
				break
			}
		}
		if newLeaderIdx >= 0 {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if newLeaderIdx < 0 {
		t.Fatal("no new leader elected after failover")
	}
	t.Logf("new leader is node-%d", newLeaderIdx)

	// Write via new leader.
	tx2, err := c.nodes[newLeaderIdx].Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("begin tx on new leader: %v", err)
	}
	route2, err := tx2.CreateRoute(ctx, &riokuv1.Route{
		Name:    "after-failover",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("create route on new leader: %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	t.Logf("created route after failover: id=%s", route2.GetId())

	// Verify both routes are readable from the new leader.
	rtx, _ := c.nodes[newLeaderIdx].Begin(ctx, store.TxOptions{ReadOnly: true})
	routes, err := rtx.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("list routes: %v", err)
	}
	_ = rtx.Rollback()

	if len(routes) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(routes))
	}
}

func TestRouteListAndDelete(t *testing.T) {
	c := newTestCluster(t, 1)
	c.start()
	defer c.stop()

	ctx := context.Background()
	_, node := c.leader()

	// Create multiple routes.
	for i := 0; i < 5; i++ {
		tx, _ := node.Begin(ctx, store.TxOptions{})
		_, err := tx.CreateRoute(ctx, &riokuv1.Route{
			Name:    fmt.Sprintf("route-%d", i),
			Enabled: true,
		})
		if err != nil {
			t.Fatalf("create route %d: %v", i, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit route %d: %v", i, err)
		}
	}

	// List routes.
	rtx, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
	routes, err := rtx.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("list routes: %v", err)
	}
	_ = rtx.Rollback()

	if len(routes) != 5 {
		t.Fatalf("expected 5 routes, got %d", len(routes))
	}

	// Delete one.
	dtx, _ := node.Begin(ctx, store.TxOptions{})
	if err := dtx.DeleteRoute(ctx, routes[0].GetId()); err != nil {
		t.Fatalf("delete route: %v", err)
	}
	if err := dtx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// Verify 4 remain.
	rtx2, _ := node.Begin(ctx, store.TxOptions{ReadOnly: true})
	routes2, _ := rtx2.ListRoutes(ctx)
	_ = rtx2.Rollback()

	if len(routes2) != 4 {
		t.Fatalf("expected 4 routes after delete, got %d", len(routes2))
	}
}

func TestHealth(t *testing.T) {
	c := newTestCluster(t, 1)
	c.start()
	defer c.stop()

	ctx := context.Background()
	h := c.nodes[0].Health(ctx)

	if !h.OK {
		t.Errorf("expected healthy, got not OK")
	}
	if h.Mode != store.ModePrimary {
		t.Errorf("expected ModePrimary for leader, got %d", h.Mode)
	}
	if h.Details["state"] != "Leader" {
		t.Errorf("expected state=Leader, got %q", h.Details["state"])
	}
}

func TestNotify(t *testing.T) {
	c := newTestCluster(t, 1)
	c.start()
	defer c.stop()

	ctx := context.Background()
	_, node := c.leader()

	ch := node.Notify()
	if ch == nil {
		t.Fatal("expected non-nil notify channel")
	}

	// Create a route and check for notification.
	tx, _ := node.Begin(ctx, store.TxOptions{})
	_, err := tx.CreateRoute(ctx, &riokuv1.Route{Name: "notified", Enabled: true})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	select {
	case evt := <-ch:
		if evt.Table != "routes" || evt.Operation != "INSERT" {
			t.Errorf("unexpected event: %+v", evt)
		}
	case <-time.After(2 * time.Second):
		t.Error("timed out waiting for change event")
	}
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

func BenchmarkWriteRoute(b *testing.B) {
	dir := b.TempDir()
	d := &Driver{}
	addr := "127.0.0.1:17799"
	d.SetRaftConfig(RaftConfig{
		NodeID:        "bench-node",
		DataDir:       filepath.Join(dir, "data"),
		BindAddr:      addr,
		AdvertiseAddr: addr,
		Bootstrap:     true,
	})

	ctx := context.Background()
	if err := d.Open(ctx, store.DriverConfig{}); err != nil {
		b.Fatalf("open: %v", err)
	}
	defer func() { _ = d.Close() }()

	// Wait for leader.
	deadline := time.Now().Add(10 * time.Second)
	for !d.IsLeader() && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	if !d.IsLeader() {
		b.Fatal("not leader")
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tx, _ := d.Begin(ctx, store.TxOptions{})
		_, err := tx.CreateRoute(ctx, &riokuv1.Route{
			Name:    fmt.Sprintf("bench-route-%d", i),
			Enabled: true,
		})
		if err != nil {
			b.Fatalf("create route: %v", err)
		}
		_ = tx.Commit()
	}
}

func BenchmarkReadRoute(b *testing.B) {
	dir := b.TempDir()
	d := &Driver{}
	addr := "127.0.0.1:17798"
	d.SetRaftConfig(RaftConfig{
		NodeID:        "bench-read-node",
		DataDir:       filepath.Join(dir, "data"),
		BindAddr:      addr,
		AdvertiseAddr: addr,
		Bootstrap:     true,
	})

	ctx := context.Background()
	if err := d.Open(ctx, store.DriverConfig{}); err != nil {
		b.Fatalf("open: %v", err)
	}
	defer func() { _ = d.Close() }()

	deadline := time.Now().Add(10 * time.Second)
	for !d.IsLeader() && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}

	// Seed a route.
	tx, _ := d.Begin(ctx, store.TxOptions{})
	route, _ := tx.CreateRoute(ctx, &riokuv1.Route{Name: "bench-read", Enabled: true})
	_ = tx.Commit()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rtx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
		_, err := rtx.GetRoute(ctx, route.GetId())
		if err != nil {
			b.Fatalf("get route: %v", err)
		}
		_ = rtx.Rollback()
	}
}
