package vault

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// countingBackend tracks how many times Resolve runs, so cache hits
// can be observed independently of the value returned.
type countingBackend struct {
	calls atomic.Int64
	value string
	err   error
}

func (*countingBackend) Name() string { return "count" }
func (*countingBackend) Sync() bool   { return true }
func (b *countingBackend) Resolve(_ context.Context, _ string) (string, error) {
	b.calls.Add(1)
	return b.value, b.err
}

func newCachingResolverWith(t *testing.T, ttl time.Duration, b Backend) *CachingResolver {
	t.Helper()
	inner := NewResolver()
	inner.Register(b)
	return NewCachingResolver(inner, ttl)
}

func TestCachingResolver_HitsAfterFirstResolve(t *testing.T) {
	b := &countingBackend{value: "v"}
	c := newCachingResolverWith(t, 1*time.Hour, b)

	ref := MustParse("{vault://count/anything}")
	for i := 0; i < 5; i++ {
		got, err := c.Resolve(context.Background(), ref)
		if err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if got != "v" {
			t.Fatalf("iter %d: got %q, want v", i, got)
		}
	}
	if calls := b.calls.Load(); calls != 1 {
		t.Fatalf("backend called %d times, want 1 (cache should serve the rest)", calls)
	}
}

func TestCachingResolver_FailuresAreNotCached(t *testing.T) {
	b := &countingBackend{err: errors.New("flaky")}
	c := newCachingResolverWith(t, 1*time.Hour, b)
	ref := MustParse("{vault://count/x}")

	for i := 0; i < 3; i++ {
		if _, err := c.Resolve(context.Background(), ref); err == nil {
			t.Fatalf("iter %d: expected error", i)
		}
	}
	// Each failed resolve must reach the backend — otherwise a
	// transient outage poisons the cache for the entire TTL.
	if calls := b.calls.Load(); calls != 3 {
		t.Fatalf("backend called %d times, want 3 (failures must not be cached)", calls)
	}
}

func TestCachingResolver_TTLExpires(t *testing.T) {
	b := &countingBackend{value: "v"}
	c := newCachingResolverWith(t, 5*time.Millisecond, b)
	ref := MustParse("{vault://count/x}")

	if _, err := c.Resolve(context.Background(), ref); err != nil {
		t.Fatalf("initial: %v", err)
	}
	time.Sleep(15 * time.Millisecond)
	if _, err := c.Resolve(context.Background(), ref); err != nil {
		t.Fatalf("after expiry: %v", err)
	}
	if calls := b.calls.Load(); calls != 2 {
		t.Fatalf("backend called %d times, want 2", calls)
	}
}

func TestCachingResolver_TTLZeroDisables(t *testing.T) {
	b := &countingBackend{value: "v"}
	c := newCachingResolverWith(t, 0, b)
	ref := MustParse("{vault://count/x}")

	for i := 0; i < 3; i++ {
		if _, err := c.Resolve(context.Background(), ref); err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
	}
	if calls := b.calls.Load(); calls != 3 {
		t.Fatalf("backend called %d times, want 3 (ttl=0 disables cache)", calls)
	}
	if c.Len() != 0 {
		t.Fatalf("cache size = %d, want 0", c.Len())
	}
}

func TestCachingResolver_InvalidateForcesRefetch(t *testing.T) {
	b := &countingBackend{value: "v"}
	c := newCachingResolverWith(t, 1*time.Hour, b)
	ref := MustParse("{vault://count/x}")

	if _, err := c.Resolve(context.Background(), ref); err != nil {
		t.Fatalf("initial: %v", err)
	}
	c.Invalidate(ref.Raw)
	if _, err := c.Resolve(context.Background(), ref); err != nil {
		t.Fatalf("after invalidate: %v", err)
	}
	if calls := b.calls.Load(); calls != 2 {
		t.Fatalf("backend called %d times, want 2", calls)
	}
}

func TestCachingResolver_FlushClearsAll(t *testing.T) {
	b := &countingBackend{value: "v"}
	c := newCachingResolverWith(t, 1*time.Hour, b)

	for i, raw := range []string{"{vault://count/a}", "{vault://count/b}"} {
		if _, err := c.ResolveString(context.Background(), raw); err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
	}
	if c.Len() != 2 {
		t.Fatalf("cache size = %d, want 2", c.Len())
	}
	c.Flush()
	if c.Len() != 0 {
		t.Fatalf("cache size after flush = %d, want 0", c.Len())
	}
}

func TestCachingResolver_RotationLoopFlushesPeriodically(t *testing.T) {
	b := &countingBackend{value: "v"}
	c := newCachingResolverWith(t, 1*time.Hour, b)
	if _, err := c.ResolveString(context.Background(), "{vault://count/x}"); err != nil {
		t.Fatalf("initial: %v", err)
	}
	if c.Len() != 1 {
		t.Fatalf("cache size = %d, want 1", c.Len())
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.RotationLoop(ctx, 5*time.Millisecond)

	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) {
		if c.Len() == 0 {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("rotation loop did not flush within deadline")
}

func TestCachingResolver_ResolveAllAtomicityOnFailure(t *testing.T) {
	inner := NewResolver()
	inner.Register(&countingBackend{value: "ok"})
	inner.Register(&fakeBackend{name: "miss", err: errors.New("nope")})

	c := NewCachingResolver(inner, 1*time.Hour)
	out, err := c.ResolveAll(context.Background(), map[string]string{
		"a": "{vault://count/x}",
		"b": "{vault://miss/y}",
	})
	if err == nil {
		t.Fatalf("expected error on partial failure")
	}
	if out != nil {
		t.Fatalf("expected nil map on partial failure")
	}
}
