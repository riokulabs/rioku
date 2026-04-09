package crdt

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestPNCounterBasic(t *testing.T) {
	c := NewPNCounter()
	c.Increment("node-0", 5)
	c.Increment("node-1", 3)
	c.Decrement("node-0", 2)

	if v := c.Value(); v != 6 {
		t.Errorf("expected 6, got %d", v)
	}
}

func TestPNCounterMerge(t *testing.T) {
	// Simulate two nodes with independent counters.
	a := NewPNCounter()
	a.Increment("node-0", 10)
	a.Increment("node-1", 5)

	b := NewPNCounter()
	b.Increment("node-0", 7) // node-0 has fewer on b (stale)
	b.Increment("node-1", 8) // node-1 has more on b

	// Merge b into a — element-wise max.
	a.Merge(b)

	// node-0 should keep 10 (max of 10, 7).
	// node-1 should take 8 (max of 5, 8).
	if v := a.Value(); v != 18 {
		t.Errorf("expected 18, got %d", v)
	}
	if a.P["node-0"] != 10 {
		t.Errorf("node-0 P should be 10, got %d", a.P["node-0"])
	}
	if a.P["node-1"] != 8 {
		t.Errorf("node-1 P should be 8, got %d", a.P["node-1"])
	}
}

func TestPNCounterMergeIdempotent(t *testing.T) {
	a := NewPNCounter()
	a.Increment("node-0", 10)

	b := a.Clone()

	// Merging the same state should not change value.
	a.Merge(b)
	if v := a.Value(); v != 10 {
		t.Errorf("expected 10 after idempotent merge, got %d", v)
	}

	// Merge again.
	a.Merge(b)
	if v := a.Value(); v != 10 {
		t.Errorf("expected 10 after double merge, got %d", v)
	}
}

func TestCounterSetBasic(t *testing.T) {
	cs := NewCounterSet("node-0", 5*time.Minute)

	cs.Increment("rate:api:/users", 1)
	cs.Increment("rate:api:/users", 1)
	cs.Increment("rate:api:/users", 1)

	if v := cs.Value("rate:api:/users"); v != 3 {
		t.Errorf("expected 3, got %d", v)
	}

	// Non-existent counter returns 0.
	if v := cs.Value("nonexistent"); v != 0 {
		t.Errorf("expected 0 for nonexistent counter, got %d", v)
	}
}

func TestCounterSetMerge(t *testing.T) {
	cs0 := NewCounterSet("node-0", 5*time.Minute)
	cs1 := NewCounterSet("node-1", 5*time.Minute)

	// Both nodes increment the same counter.
	cs0.Increment("rate:api:/users", 10)
	cs1.Increment("rate:api:/users", 7)

	// Merge cs1's state into cs0.
	cs0.MergeRemote(cs1.Snapshot())

	// cs0 should see the sum: node-0=10 + node-1=7 = 17.
	if v := cs0.Value("rate:api:/users"); v != 17 {
		t.Errorf("expected 17, got %d", v)
	}
}

func TestCounterSetGC(t *testing.T) {
	cs := NewCounterSet("node-0", 100*time.Millisecond)

	cs.Increment("old-counter", 1)
	time.Sleep(200 * time.Millisecond)
	cs.Increment("new-counter", 1) // recent, should survive

	removed := cs.GC()
	if removed != 1 {
		t.Errorf("expected 1 removed, got %d", removed)
	}
	if cs.Len() != 1 {
		t.Errorf("expected 1 counter after GC, got %d", cs.Len())
	}
	if v := cs.Value("new-counter"); v != 1 {
		t.Errorf("new-counter should still be 1, got %d", v)
	}
}

func TestCounterSetSnapshotSerialization(t *testing.T) {
	cs := NewCounterSet("node-0", 5*time.Minute)
	cs.Increment("counter-a", 42)
	cs.Increment("counter-b", 7)

	snap := cs.Snapshot()
	data, err := MarshalCounterSet(snap)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	decoded, err := UnmarshalCounterSet(data)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Merge decoded into a new CounterSet.
	cs2 := NewCounterSet("node-1", 5*time.Minute)
	cs2.MergeRemote(decoded)

	if v := cs2.Value("counter-a"); v != 42 {
		t.Errorf("expected 42, got %d", v)
	}
	if v := cs2.Value("counter-b"); v != 7 {
		t.Errorf("expected 7, got %d", v)
	}
}

func TestCounterSetConcurrent(t *testing.T) {
	cs := NewCounterSet("node-0", 5*time.Minute)
	const goroutines = 100
	const increments = 1000

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for g := 0; g < goroutines; g++ {
		go func() {
			defer wg.Done()
			for i := 0; i < increments; i++ {
				cs.Increment("hot-counter", 1)
			}
		}()
	}
	wg.Wait()

	if v := cs.Value("hot-counter"); v != goroutines*increments {
		t.Errorf("expected %d, got %d", goroutines*increments, v)
	}
}

func TestThreeNodeConvergence(t *testing.T) {
	// Simulate 3 nodes incrementing independently, then merging.
	nodes := make([]*CounterSet, 3)
	for i := 0; i < 3; i++ {
		nodes[i] = NewCounterSet(fmt.Sprintf("node-%d", i), 5*time.Minute)
	}

	// Each node increments independently.
	nodes[0].Increment("rate:limit", 100)
	nodes[1].Increment("rate:limit", 200)
	nodes[2].Increment("rate:limit", 150)

	// Simulate gossip rounds: each node merges with every other.
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if i != j {
				nodes[i].MergeRemote(nodes[j].Snapshot())
			}
		}
	}

	// All nodes should converge to the same value.
	expected := int64(450) // 100 + 200 + 150
	for i, n := range nodes {
		if v := n.Value("rate:limit"); v != expected {
			t.Errorf("node-%d: expected %d, got %d", i, expected, v)
		}
	}
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

func BenchmarkIncrement(b *testing.B) {
	cs := NewCounterSet("node-0", 5*time.Minute)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cs.Increment("rate:api:/users", 1)
	}
}

func BenchmarkIncrementParallel(b *testing.B) {
	cs := NewCounterSet("node-0", 5*time.Minute)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			cs.Increment("rate:api:/users", 1)
		}
	})
}

func BenchmarkValue(b *testing.B) {
	cs := NewCounterSet("node-0", 5*time.Minute)
	cs.Increment("rate:api:/users", 1000)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cs.Value("rate:api:/users")
	}
}

func BenchmarkMerge(b *testing.B) {
	cs0 := NewCounterSet("node-0", 5*time.Minute)
	cs1 := NewCounterSet("node-1", 5*time.Minute)

	// Pre-fill with counters to simulate realistic merge.
	for i := 0; i < 100; i++ {
		cs0.Increment(fmt.Sprintf("counter-%d", i), int64(i))
		cs1.Increment(fmt.Sprintf("counter-%d", i), int64(i*2))
	}

	snap := cs1.Snapshot()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cs0.MergeRemote(snap)
	}
}

func BenchmarkSerialize(b *testing.B) {
	cs := NewCounterSet("node-0", 5*time.Minute)
	for i := 0; i < 100; i++ {
		cs.Increment(fmt.Sprintf("counter-%d", i), int64(i))
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		snap := cs.Snapshot()
		_, _ = MarshalCounterSet(snap)
	}
}
