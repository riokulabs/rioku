package vault

import (
	"context"
	"sync"
	"time"
)

// CachingResolver decorates a Resolver with a TTL cache and a rotation
// timer. It implements the same dispatch surface as Resolver while
// avoiding repeated backend round-trips during a single Caddy compile
// or short-window batch.
//
// Cache discipline (per D12 + the Phase 1d trip-wires):
//
//   - Successful resolves are cached under the verbatim Ref.Raw key
//     for the configured TTL. The cached plaintext lives in memory
//     only; nothing is persisted to disk.
//   - Failures are NOT cached. A backend that briefly returns an
//     error must not poison the cache and must not be probed harder
//     than the rotation cadence demands. (Negative-cache poisoning
//     protection per the plan's trip-wire list.)
//   - Per-reference rotation is implemented via the rotation timer:
//     every Interval the cache is fully cleared, forcing the next
//     resolve to re-fetch. We deliberately avoid per-key timers in v1
//     because the Caddy compile fan-out always touches every secret
//     anyway; a single sweep is simpler and avoids the cost of a
//     timer per secret on large deployments.
type CachingResolver struct {
	inner *Resolver
	ttl   time.Duration

	mu      sync.RWMutex
	entries map[string]cachedSecret
}

type cachedSecret struct {
	value   string
	expires time.Time
}

// NewCachingResolver wraps inner with a TTL cache. A non-positive ttl
// disables caching entirely (every Resolve hits the backend).
func NewCachingResolver(inner *Resolver, ttl time.Duration) *CachingResolver {
	if inner == nil {
		panic("vault: NewCachingResolver requires non-nil inner Resolver")
	}
	return &CachingResolver{
		inner:   inner,
		ttl:     ttl,
		entries: make(map[string]cachedSecret),
	}
}

// Inner returns the wrapped Resolver. Useful for tests and for code
// paths that need to register backends after the cache is in place.
func (c *CachingResolver) Inner() *Resolver { return c.inner }

// Resolve dispatches via the inner Resolver, caching successful
// results for ttl.
func (c *CachingResolver) Resolve(ctx context.Context, ref Ref) (string, error) {
	if c.ttl > 0 {
		if v, ok := c.lookup(ref.Raw); ok {
			return v, nil
		}
	}
	v, err := c.inner.Resolve(ctx, ref)
	if err != nil {
		return "", err
	}
	if c.ttl > 0 {
		c.store(ref.Raw, v)
	}
	return v, nil
}

// ResolveString mirrors Resolver.ResolveString but routes through the
// cache when the value is a reference. Literal pass-through is not
// cached (no point — copying a literal is faster than a map lookup).
func (c *CachingResolver) ResolveString(ctx context.Context, s string) (string, error) {
	if !IsReference(s) {
		return s, nil
	}
	ref, err := Parse(s)
	if err != nil {
		return "", err
	}
	return c.Resolve(ctx, ref)
}

// ResolveAll mirrors Resolver.ResolveAll with all-or-nothing
// atomicity. Successful entries are cached; on any failure the cache
// is left untouched for entries that hadn't yet been resolved.
func (c *CachingResolver) ResolveAll(ctx context.Context, values map[string]string) (map[string]string, error) {
	out := make(map[string]string, len(values))
	for k, raw := range values {
		v, err := c.ResolveString(ctx, raw)
		if err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, nil
}

// Invalidate removes a single ref from the cache. Useful after an
// admin update to a secret-bearing field — the next data-plane
// compile picks up the new value without waiting for the rotation
// timer.
func (c *CachingResolver) Invalidate(rawRef string) {
	c.mu.Lock()
	delete(c.entries, rawRef)
	c.mu.Unlock()
}

// Flush clears every cached entry. The rotation timer calls this on
// each tick; admin operations (e.g., "rotate all secrets now") can
// also invoke it directly.
func (c *CachingResolver) Flush() {
	c.mu.Lock()
	c.entries = make(map[string]cachedSecret)
	c.mu.Unlock()
}

// Len reports the number of cached entries. Test-and-introspection
// helper; not load-bearing.
func (c *CachingResolver) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}

func (c *CachingResolver) lookup(key string) (string, bool) {
	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok {
		return "", false
	}
	if !entry.expires.IsZero() && time.Now().After(entry.expires) {
		// Stale; let the next caller re-fetch. Don't bother
		// removing here — the next store() overwrites and the
		// next Flush() drops it.
		return "", false
	}
	return entry.value, true
}

func (c *CachingResolver) store(key, value string) {
	c.mu.Lock()
	c.entries[key] = cachedSecret{
		value:   value,
		expires: time.Now().Add(c.ttl),
	}
	c.mu.Unlock()
}

// RotationLoop runs the rotation timer until ctx is cancelled. Every
// interval it flushes the cache so subsequent resolves re-fetch the
// underlying secret. interval must be > 0; passing zero or a negative
// value returns immediately (rotation disabled).
//
// RotationLoop is intended to run on a goroutine started during
// daemon init, e.g.:
//
//	go cache.RotationLoop(daemonCtx, 5*time.Minute)
//
// The function returns when ctx is done. It does no work other than
// timing; backend availability is checked on the next resolve.
func (c *CachingResolver) RotationLoop(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		return
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.Flush()
		}
	}
}
