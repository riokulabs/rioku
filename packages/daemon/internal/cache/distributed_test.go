package cache

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func basePort() int {
	return 18500 + (os.Getpid()%500)*10
}

func TestSingleNodeCache(t *testing.T) {
	port := basePort()
	ctx := context.Background()
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	var getterCalls atomic.Int64

	dc, err := New(ctx, "test-single", func(ctx context.Context, key string) ([]byte, time.Duration, error) {
		getterCalls.Add(1)
		return []byte("value-for-" + key), 5 * time.Minute, nil
	}, Config{
		ListenAddr: addr,
		Peers:      []string{addr},
		MaxBytes:   10 * 1024 * 1024,
		L1MaxSize:  1000,
		DefaultTTL: 5 * time.Minute,
	})
	if err != nil {
		t.Fatalf("create cache: %v", err)
	}
	defer func() {
		if err := dc.Shutdown(ctx); err != nil {
			t.Fatalf("shutdown: %v", err)
		}
	}()

	// First get — should call getter.
	data, err := dc.Get(ctx, "key1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if string(data) != "value-for-key1" {
		t.Errorf("expected 'value-for-key1', got %q", string(data))
	}
	if getterCalls.Load() != 1 {
		t.Errorf("expected 1 getter call, got %d", getterCalls.Load())
	}

	// Second get — should hit L1 cache, NOT call getter.
	data2, err := dc.Get(ctx, "key1")
	if err != nil {
		t.Fatalf("get 2: %v", err)
	}
	if string(data2) != "value-for-key1" {
		t.Errorf("expected 'value-for-key1', got %q", string(data2))
	}
	if getterCalls.Load() != 1 {
		t.Errorf("expected still 1 getter call (L1 hit), got %d", getterCalls.Load())
	}
}

func TestCacheRemove(t *testing.T) {
	port := basePort() + 1
	ctx := context.Background()
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	var getterCalls atomic.Int64

	dc, err := New(ctx, "test-remove", func(ctx context.Context, key string) ([]byte, time.Duration, error) {
		getterCalls.Add(1)
		return []byte(fmt.Sprintf("v%d", getterCalls.Load())), 5 * time.Minute, nil
	}, Config{
		ListenAddr: addr,
		Peers:      []string{addr},
	})
	if err != nil {
		t.Fatalf("create cache: %v", err)
	}
	defer func() {
		if err := dc.Shutdown(ctx); err != nil {
			t.Fatalf("shutdown: %v", err)
		}
	}()

	// Populate.
	if _, err := dc.Get(ctx, "key1"); err != nil {
		t.Fatalf("get: %v", err)
	}
	if getterCalls.Load() != 1 {
		t.Fatalf("expected 1 getter call")
	}

	// Remove.
	if err := dc.Remove(ctx, "key1"); err != nil {
		t.Fatalf("remove: %v", err)
	}

	// Get again — should call getter since removed.
	_, err = dc.Get(ctx, "key1")
	if err != nil {
		t.Fatalf("get after remove: %v", err)
	}
	if getterCalls.Load() != 2 {
		t.Errorf("expected 2 getter calls after remove, got %d", getterCalls.Load())
	}
}

func TestCacheExplicitSet(t *testing.T) {
	port := basePort() + 2
	ctx := context.Background()
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	var getterCalls atomic.Int64

	dc, err := New(ctx, "test-set", func(ctx context.Context, key string) ([]byte, time.Duration, error) {
		getterCalls.Add(1)
		return []byte("from-getter"), 5 * time.Minute, nil
	}, Config{
		ListenAddr: addr,
		Peers:      []string{addr},
	})
	if err != nil {
		t.Fatalf("create cache: %v", err)
	}
	defer func() {
		if err := dc.Shutdown(ctx); err != nil {
			t.Fatalf("shutdown: %v", err)
		}
	}()

	// Explicitly set.
	if err := dc.Set(ctx, "key1", []byte("explicit-value"), time.Minute); err != nil {
		t.Fatalf("set: %v", err)
	}

	// Get — should return explicit value, not call getter.
	data, err := dc.Get(ctx, "key1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if string(data) != "explicit-value" {
		t.Errorf("expected 'explicit-value', got %q", string(data))
	}
	if getterCalls.Load() != 0 {
		t.Errorf("expected 0 getter calls, got %d", getterCalls.Load())
	}
}

func TestSingleFlight(t *testing.T) {
	port := basePort() + 3
	ctx := context.Background()
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	var getterCalls atomic.Int64

	dc, err := New(ctx, "test-singleflight", func(ctx context.Context, key string) ([]byte, time.Duration, error) {
		getterCalls.Add(1)
		time.Sleep(50 * time.Millisecond) // Slow getter to ensure overlap
		return []byte("value"), 5 * time.Minute, nil
	}, Config{
		ListenAddr: addr,
		Peers:      []string{addr},
	})
	if err != nil {
		t.Fatalf("create cache: %v", err)
	}
	defer func() { _ = dc.Shutdown(ctx) }()

	// Fire 50 concurrent requests for the same key.
	const concurrent = 50
	var wg sync.WaitGroup
	wg.Add(concurrent)
	errs := make([]error, concurrent)

	for i := 0; i < concurrent; i++ {
		go func(idx int) {
			defer wg.Done()
			_, errs[idx] = dc.Get(ctx, "hot-key")
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("goroutine %d: %v", i, err)
		}
	}

	// Single-flight should deduplicate: only 1 getter call.
	calls := getterCalls.Load()
	if calls > 2 {
		// groupcache may allow 1-2 calls due to timing, but not 50.
		t.Errorf("expected <=2 getter calls (singleflight), got %d", calls)
	}
	t.Logf("getter calls: %d (out of %d concurrent requests)", calls, concurrent)
}

func TestCacheStats(t *testing.T) {
	port := basePort() + 4
	ctx := context.Background()
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	dc, err := New(ctx, "test-stats", func(ctx context.Context, key string) ([]byte, time.Duration, error) {
		return []byte("data"), 5 * time.Minute, nil
	}, Config{
		ListenAddr: addr,
		Peers:      []string{addr},
	})
	if err != nil {
		t.Fatalf("create cache: %v", err)
	}
	defer func() { _ = dc.Shutdown(ctx) }()

	// Populate and read.
	if _, err := dc.Get(ctx, "key1"); err != nil {
		t.Fatalf("get key1: %v", err)
	}
	if _, err := dc.Get(ctx, "key1"); err != nil { // L1 hit
		t.Fatalf("get key1 (L1 hit): %v", err)
	}
	if _, err := dc.Get(ctx, "key2"); err != nil {
		t.Fatalf("get key2: %v", err)
	}

	stats := dc.Stats()
	t.Logf("stats: gets=%d cacheHits=%d loads=%d L1Size=%d",
		stats.Gets, stats.CacheHits, stats.Loads, stats.L1Size)

	if stats.L1Size < 2 {
		t.Errorf("expected at least 2 L1 entries, got %d", stats.L1Size)
	}
}

func TestThreeNodePeerFetch(t *testing.T) {
	port := basePort() + 10
	ctx := context.Background()

	addrs := []string{
		fmt.Sprintf("127.0.0.1:%d", port),
		fmt.Sprintf("127.0.0.1:%d", port+1),
		fmt.Sprintf("127.0.0.1:%d", port+2),
	}

	var getterCalls [3]atomic.Int64

	caches := make([]*DistributedCache, 3)
	for i := 0; i < 3; i++ {
		idx := i
		var err error
		caches[i], err = New(ctx, "test-3node", func(ctx context.Context, key string) ([]byte, time.Duration, error) {
			getterCalls[idx].Add(1)
			return []byte(fmt.Sprintf("node%d:%s", idx, key)), 5 * time.Minute, nil
		}, Config{
			ListenAddr: addrs[i],
			Peers:      addrs,
			MaxBytes:   10 * 1024 * 1024,
		})
		if err != nil {
			t.Fatalf("create cache %d: %v", i, err)
		}
	}
	defer func() {
		for _, c := range caches {
			_ = c.Shutdown(ctx)
		}
	}()

	// Give peers time to connect.
	time.Sleep(500 * time.Millisecond)

	// Request a key from node-0 — it may be owned by any node due to consistent hashing.
	data, err := caches[0].Get(ctx, "test-key")
	if err != nil {
		t.Fatalf("get from node-0: %v", err)
	}
	t.Logf("got from node-0: %q", string(data))

	// Request the same key from node-1 — should be fetched from the peer that owns it.
	data2, err := caches[1].Get(ctx, "test-key")
	if err != nil {
		t.Fatalf("get from node-1: %v", err)
	}
	t.Logf("got from node-1: %q", string(data2))

	// Total getter calls across all nodes should be exactly 1 (or at most 2 with L1 miss race).
	total := getterCalls[0].Load() + getterCalls[1].Load() + getterCalls[2].Load()
	if total > 2 {
		t.Errorf("expected <=2 total getter calls across 3 nodes, got %d", total)
	}
	t.Logf("total getter calls: %d (node0=%d, node1=%d, node2=%d)",
		total, getterCalls[0].Load(), getterCalls[1].Load(), getterCalls[2].Load())
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

func BenchmarkL1Hit(b *testing.B) {
	port := basePort() + 20
	ctx := context.Background()
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	dc, err := New(ctx, "bench-l1", func(ctx context.Context, key string) ([]byte, time.Duration, error) {
		return []byte("benchmark-value"), 5 * time.Minute, nil
	}, Config{
		ListenAddr: addr,
		Peers:      []string{addr},
	})
	if err != nil {
		b.Fatalf("create cache: %v", err)
	}
	defer func() { _ = dc.Shutdown(ctx) }()

	// Warm L1.
	if _, err := dc.Get(ctx, "bench-key"); err != nil {
		b.Fatalf("warm L1: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = dc.Get(ctx, "bench-key")
	}
}

func BenchmarkGroupcacheHit(b *testing.B) {
	port := basePort() + 21
	ctx := context.Background()
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	dc, err := New(ctx, "bench-gc", func(ctx context.Context, key string) ([]byte, time.Duration, error) {
		return []byte("benchmark-value"), 5 * time.Minute, nil
	}, Config{
		ListenAddr: addr,
		Peers:      []string{addr},
		L1MaxSize:  1, // Minimal L1 to force groupcache hits
	})
	if err != nil {
		b.Fatalf("create cache: %v", err)
	}
	defer func() { _ = dc.Shutdown(ctx) }()

	// Populate groupcache but use different keys to evict from L1.
	if _, err := dc.Get(ctx, "warmup"); err != nil {
		b.Fatalf("warmup: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = dc.Get(ctx, fmt.Sprintf("key-%d", i%100))
	}
}
