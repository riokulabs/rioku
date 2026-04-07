// Package crdt provides conflict-free replicated data types (CRDTs)
// for distributed shared state over memberlist gossip.
//
// The primary use case is rate limit counters: each node increments
// locally (zero latency), and counter state converges across nodes
// via periodic gossip merges.
package crdt

import (
	"encoding/json"
	"sync"
	"time"
)

// PNCounter is a positive-negative counter CRDT.
// Each node maintains its own increment (P) and decrement (N) counts.
// The total value = sum(all P) - sum(all N).
// Merge = element-wise max of all P and N vectors.
type PNCounter struct {
	P map[string]int64 `json:"p"` // per-node increment counts
	N map[string]int64 `json:"n"` // per-node decrement counts
}

// NewPNCounter creates a new PNCounter.
func NewPNCounter() *PNCounter {
	return &PNCounter{
		P: make(map[string]int64),
		N: make(map[string]int64),
	}
}

// Value returns the current counter value: sum(P) - sum(N).
func (c *PNCounter) Value() int64 {
	var p, n int64
	for _, v := range c.P {
		p += v
	}
	for _, v := range c.N {
		n += v
	}
	return p - n
}

// Increment adds delta to this node's positive count.
func (c *PNCounter) Increment(nodeID string, delta int64) {
	c.P[nodeID] += delta
}

// Decrement adds delta to this node's negative count.
func (c *PNCounter) Decrement(nodeID string, delta int64) {
	c.N[nodeID] += delta
}

// Merge merges a remote counter into this one using element-wise max.
func (c *PNCounter) Merge(other *PNCounter) {
	for id, v := range other.P {
		if v > c.P[id] {
			c.P[id] = v
		}
	}
	for id, v := range other.N {
		if v > c.N[id] {
			c.N[id] = v
		}
	}
}

// Clone returns a deep copy.
func (c *PNCounter) Clone() *PNCounter {
	cp := NewPNCounter()
	for k, v := range c.P {
		cp.P[k] = v
	}
	for k, v := range c.N {
		cp.N[k] = v
	}
	return cp
}

// ---------------------------------------------------------------------------
// CounterSet — a collection of named PNCounters with TTL-based expiry
// ---------------------------------------------------------------------------

// CounterSet manages a set of named counters with TTL-based garbage collection.
// Thread-safe for concurrent access from request goroutines.
type CounterSet struct {
	mu       sync.RWMutex
	nodeID   string
	counters map[string]*counterEntry
	ttl      time.Duration
}

type counterEntry struct {
	counter  *PNCounter
	lastUsed time.Time
}

// NewCounterSet creates a new CounterSet.
func NewCounterSet(nodeID string, ttl time.Duration) *CounterSet {
	cs := &CounterSet{
		nodeID:   nodeID,
		counters: make(map[string]*counterEntry),
		ttl:      ttl,
	}
	return cs
}

// Increment atomically increments a named counter by delta.
// Creates the counter if it doesn't exist.
func (cs *CounterSet) Increment(name string, delta int64) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	e := cs.getOrCreate(name)
	e.counter.Increment(cs.nodeID, delta)
	e.lastUsed = time.Now()
}

// Decrement atomically decrements a named counter by delta.
func (cs *CounterSet) Decrement(name string, delta int64) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	e := cs.getOrCreate(name)
	e.counter.Decrement(cs.nodeID, delta)
	e.lastUsed = time.Now()
}

// Value returns the current value of a named counter.
// Returns 0 if the counter doesn't exist.
func (cs *CounterSet) Value(name string) int64 {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	e, ok := cs.counters[name]
	if !ok {
		return 0
	}
	return e.counter.Value()
}

// MergeRemote merges a remote CounterSet state into this one.
func (cs *CounterSet) MergeRemote(remote map[string]*PNCounter) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	for name, rc := range remote {
		e := cs.getOrCreate(name)
		e.counter.Merge(rc)
		e.lastUsed = time.Now()
	}
}

// Snapshot returns a serializable snapshot of all counters for gossip.
func (cs *CounterSet) Snapshot() map[string]*PNCounter {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	snap := make(map[string]*PNCounter, len(cs.counters))
	for name, e := range cs.counters {
		snap[name] = e.counter.Clone()
	}
	return snap
}

// GC removes counters that haven't been used within the TTL.
// Returns the number of counters removed.
func (cs *CounterSet) GC() int {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cutoff := time.Now().Add(-cs.ttl)
	removed := 0
	for name, e := range cs.counters {
		if e.lastUsed.Before(cutoff) {
			delete(cs.counters, name)
			removed++
		}
	}
	return removed
}

// Len returns the number of counters.
func (cs *CounterSet) Len() int {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return len(cs.counters)
}

// StartGC starts a background goroutine that runs GC periodically.
// Returns a stop function.
func (cs *CounterSet) StartGC(interval time.Duration) func() {
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				cs.GC()
			case <-stop:
				return
			}
		}
	}()
	return func() { close(stop) }
}

func (cs *CounterSet) getOrCreate(name string) *counterEntry {
	e, ok := cs.counters[name]
	if !ok {
		e = &counterEntry{
			counter:  NewPNCounter(),
			lastUsed: time.Now(),
		}
		cs.counters[name] = e
	}
	return e
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

// MarshalCounterSet serializes a counter snapshot for gossip transmission.
func MarshalCounterSet(snap map[string]*PNCounter) ([]byte, error) {
	return json.Marshal(snap)
}

// UnmarshalCounterSet deserializes a counter snapshot received via gossip.
func UnmarshalCounterSet(data []byte) (map[string]*PNCounter, error) {
	var snap map[string]*PNCounter
	err := json.Unmarshal(data, &snap)
	return snap, err
}
