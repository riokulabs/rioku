package cluster

import (
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

// mockVoterManager tracks AddVoter/RemoveServer calls for testing.
type mockVoterManager struct {
	mu       sync.Mutex
	isLeader bool
	added    []string
	removed  []string
}

func (m *mockVoterManager) AddVoter(id, addr string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.added = append(m.added, id)
	return nil
}

func (m *mockVoterManager) RemoveServer(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.removed = append(m.removed, id)
	return nil
}

func (m *mockVoterManager) IsLeader() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.isLeader
}

func (m *mockVoterManager) getAdded() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]string, len(m.added))
	copy(cp, m.added)
	return cp
}

func (m *mockVoterManager) getRemoved() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]string, len(m.removed))
	copy(cp, m.removed)
	return cp
}

func basePort() int {
	return 17800 + (os.Getpid()%500)*10
}

func TestDiscoveryThreeNodes(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping discovery test in short mode")
	}
	port := basePort()
	vm := &mockVoterManager{isLeader: true}

	// Node 0 — the "leader".
	d0 := New(DiscoveryConfig{
		NodeMeta: NodeMeta{
			NodeID:   "node-0",
			RaftAddr: fmt.Sprintf("127.0.0.1:%d", port+100),
			RPCPort:  port + 200,
			Role:     "voter",
			Version:  "0.1.0",
		},
		BindAddr:     "127.0.0.1",
		BindPort:     port,
		VoterManager: vm,
	})
	if err := d0.Start(); err != nil {
		t.Fatalf("start node-0: %v", err)
	}
	defer func() {
		if err := d0.Stop(); err != nil {
			t.Logf("stop node-0: %v", err)
		}
	}()

	// Node 1 — joins via node-0.
	d1 := New(DiscoveryConfig{
		NodeMeta: NodeMeta{
			NodeID:   "node-1",
			RaftAddr: fmt.Sprintf("127.0.0.1:%d", port+101),
			RPCPort:  port + 201,
			Role:     "voter",
			Version:  "0.1.0",
		},
		BindAddr:  "127.0.0.1",
		BindPort:  port + 1,
		SeedAddrs: []string{fmt.Sprintf("127.0.0.1:%d", port)},
	})
	if err := d1.Start(); err != nil {
		t.Fatalf("start node-1: %v", err)
	}
	defer func() {
		if err := d1.Stop(); err != nil {
			t.Logf("stop node-1: %v", err)
		}
	}()

	// Node 2 — joins via node-0.
	d2 := New(DiscoveryConfig{
		NodeMeta: NodeMeta{
			NodeID:   "node-2",
			RaftAddr: fmt.Sprintf("127.0.0.1:%d", port+102),
			RPCPort:  port + 202,
			Role:     "voter",
			Version:  "0.1.0",
		},
		BindAddr:  "127.0.0.1",
		BindPort:  port + 2,
		SeedAddrs: []string{fmt.Sprintf("127.0.0.1:%d", port)},
	})
	if err := d2.Start(); err != nil {
		t.Fatalf("start node-2: %v", err)
	}
	defer func() {
		if err := d2.Stop(); err != nil {
			t.Logf("stop node-2: %v", err)
		}
	}()

	// Wait for gossip to converge.
	time.Sleep(2 * time.Second)

	// Verify all nodes see all 3 members.
	for i, d := range []*Discovery{d0, d1, d2} {
		n := d.NumMembers()
		if n != 3 {
			t.Errorf("node-%d sees %d members, expected 3", i, n)
		}
	}

	// Verify the voter manager received AddVoter calls for node-1 and node-2.
	added := vm.getAdded()
	if len(added) < 2 {
		t.Errorf("expected at least 2 AddVoter calls, got %d: %v", len(added), added)
	}

	t.Logf("added voters: %v", added)
	t.Logf("node-0 members: %d", d0.NumMembers())
}

func TestDiscoveryNodeLeaveAndRemoval(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping discovery test in short mode")
	}
	port := basePort() + 20
	vm := &mockVoterManager{isLeader: true}

	d0 := New(DiscoveryConfig{
		NodeMeta: NodeMeta{
			NodeID:   "node-a",
			RaftAddr: fmt.Sprintf("127.0.0.1:%d", port+100),
			RPCPort:  port + 200,
			Role:     "voter",
		},
		BindAddr:           "127.0.0.1",
		BindPort:           port,
		VoterManager:       vm,
		FailureGracePeriod: 1 * time.Second, // Short for testing
	})
	if err := d0.Start(); err != nil {
		t.Fatalf("start node-a: %v", err)
	}
	defer func() {
		if err := d0.Stop(); err != nil {
			t.Logf("stop node-a: %v", err)
		}
	}()

	d1 := New(DiscoveryConfig{
		NodeMeta: NodeMeta{
			NodeID:   "node-b",
			RaftAddr: fmt.Sprintf("127.0.0.1:%d", port+101),
			RPCPort:  port + 201,
			Role:     "voter",
		},
		BindAddr:  "127.0.0.1",
		BindPort:  port + 1,
		SeedAddrs: []string{fmt.Sprintf("127.0.0.1:%d", port)},
	})
	if err := d1.Start(); err != nil {
		t.Fatalf("start node-b: %v", err)
	}

	// Wait for convergence.
	time.Sleep(2 * time.Second)

	if d0.NumMembers() != 2 {
		t.Fatalf("expected 2 members, got %d", d0.NumMembers())
	}

	// Shut down node-b.
	t.Log("shutting down node-b")
	if err := d1.Stop(); err != nil {
		t.Logf("stop node-b: %v", err)
	}

	// Wait for memberlist to detect the failure (suspicion ~2s) + grace period (1s) + buffer.
	time.Sleep(6 * time.Second)

	// Verify voter manager received RemoveServer for node-b.
	removed := vm.getRemoved()
	if len(removed) == 0 {
		t.Error("expected RemoveServer call for node-b after grace period")
	} else {
		found := false
		for _, r := range removed {
			if r == "node-b" {
				found = true
			}
		}
		if !found {
			t.Errorf("expected node-b in removed list, got %v", removed)
		}
	}

	t.Logf("removed servers: %v", removed)
}

func TestDiscoveryNodeRejoinCancelsRemoval(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping discovery test in short mode")
	}
	port := basePort() + 40
	vm := &mockVoterManager{isLeader: true}

	d0 := New(DiscoveryConfig{
		NodeMeta: NodeMeta{
			NodeID:   "node-x",
			RaftAddr: fmt.Sprintf("127.0.0.1:%d", port+100),
		},
		BindAddr:           "127.0.0.1",
		BindPort:           port,
		VoterManager:       vm,
		FailureGracePeriod: 5 * time.Second, // Long enough that rejoin happens first
	})
	if err := d0.Start(); err != nil {
		t.Fatalf("start node-x: %v", err)
	}
	defer func() {
		if err := d0.Stop(); err != nil {
			t.Logf("stop node-x: %v", err)
		}
	}()

	d1 := New(DiscoveryConfig{
		NodeMeta: NodeMeta{
			NodeID:   "node-y",
			RaftAddr: fmt.Sprintf("127.0.0.1:%d", port+101),
		},
		BindAddr:  "127.0.0.1",
		BindPort:  port + 1,
		SeedAddrs: []string{fmt.Sprintf("127.0.0.1:%d", port)},
	})
	if err := d1.Start(); err != nil {
		t.Fatalf("start node-y: %v", err)
	}

	time.Sleep(2 * time.Second)

	// Kill node-y.
	if err := d1.Stop(); err != nil {
		t.Logf("stop node-y: %v", err)
	}
	time.Sleep(1 * time.Second)

	// Rejoin before grace period expires.
	d1b := New(DiscoveryConfig{
		NodeMeta: NodeMeta{
			NodeID:   "node-y",
			RaftAddr: fmt.Sprintf("127.0.0.1:%d", port+101),
		},
		BindAddr:  "127.0.0.1",
		BindPort:  port + 1,
		SeedAddrs: []string{fmt.Sprintf("127.0.0.1:%d", port)},
	})
	if err := d1b.Start(); err != nil {
		t.Fatalf("rejoin node-y: %v", err)
	}
	defer func() {
		if err := d1b.Stop(); err != nil {
			t.Logf("stop node-y (rejoined): %v", err)
		}
	}()

	// Wait past the original grace period.
	time.Sleep(6 * time.Second)

	// Verify RemoveServer was NOT called for node-y (timer was canceled).
	removed := vm.getRemoved()
	for _, r := range removed {
		if r == "node-y" {
			t.Error("node-y should NOT have been removed (rejoined before grace period)")
		}
	}
	t.Logf("removed: %v (expected empty for node-y)", removed)
}

func TestDiscoveryMemberlistStats(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping discovery test in short mode")
	}
	port := basePort() + 60
	d := New(DiscoveryConfig{
		NodeMeta: NodeMeta{NodeID: "stats-node"},
		BindAddr: "127.0.0.1",
		BindPort: port,
	})
	if err := d.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer func() {
		if err := d.Stop(); err != nil {
			t.Logf("stop: %v", err)
		}
	}()

	stats := d.MemberlistStats()
	if stats == nil {
		t.Fatal("expected non-nil stats")
	}
	if stats["member_count"] != "1" {
		t.Errorf("expected 1 member, got %s", stats["member_count"])
	}
	t.Logf("stats: %v", stats)
}
