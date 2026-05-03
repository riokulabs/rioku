package logging

import (
	"context"
	"sync"
)

// ─── Sample-rate cache (#198 phase 2) ───────────────────────────────────────
//
// SampleRateCache holds the active log_sample_rate per route ID. Phase 1
// (#119) shipped the SamplingHandler primitive; phase 2 adds the
// route-id-keyed cache the daemon's request-handling pipeline reads
// when populating the log_sample_rate attribute.
//
// Read path is lock-free for the common case (RWMutex.RLock + map read);
// writes happen on config-snapshot changes only, so contention is
// negligible. The cache is process-scoped — no persistence — and is
// repopulated from the routes table whenever the engine reconciles a
// new snapshot.

// SampleRateCache maps route ID -> sample rate in [0.0, 1.0]. Routes
// not present in the cache fall through to the default (1.0 — keep
// every record). The zero value is a usable empty cache.
type SampleRateCache struct {
	mu    sync.RWMutex
	rates map[string]float64
}

// NewSampleRateCache returns an empty cache. Callers populate via
// Replace whenever a new config snapshot lands.
func NewSampleRateCache() *SampleRateCache {
	return &SampleRateCache{rates: make(map[string]float64)}
}

// Replace swaps in a fresh route -> rate map atomically. Callers
// pass a fully-built map rather than a per-route Set sequence so the
// cache transitions atomically — no half-applied state visible to
// readers mid-snapshot reload.
func (c *SampleRateCache) Replace(rates map[string]float64) {
	if rates == nil {
		rates = make(map[string]float64)
	}
	c.mu.Lock()
	c.rates = rates
	c.mu.Unlock()
}

// Get returns the sample rate configured for routeID and a boolean
// indicating whether the route is in the cache. Routes that aren't
// in the cache should be treated as fully-sampled (rate=1.0) by
// callers — the boolean lets callers decide whether to attach the
// log_sample_rate attribute at all.
func (c *SampleRateCache) Get(routeID string) (float64, bool) {
	if c == nil || routeID == "" {
		return 0, false
	}
	c.mu.RLock()
	rate, ok := c.rates[routeID]
	c.mu.RUnlock()
	return rate, ok
}

// Len returns the number of cached routes. Test/observability hook.
func (c *SampleRateCache) Len() int {
	if c == nil {
		return 0
	}
	c.mu.RLock()
	n := len(c.rates)
	c.mu.RUnlock()
	return n
}

// ─── Context plumbing ──────────────────────────────────────────────────────

const (
	ctxKeyLogSampleRate ctxKey = iota + 100 // offset to avoid colliding with context.go
	ctxKeyRouteID
)

// WithLogSampleRate stashes the sample rate on ctx so the
// ContextHandler attaches it to every record emitted under that ctx.
// Pass a value in [0.0, 1.0]; SamplingHandler clamps out-of-range
// values, so callers don't need to validate.
func WithLogSampleRate(ctx context.Context, rate float64) context.Context {
	return context.WithValue(ctx, ctxKeyLogSampleRate, rate)
}

// LogSampleRateFromContext returns the rate set on ctx and a boolean
// signalling presence. Absence implies "default rate 1.0" — callers
// should not assume the absent state means anything else.
func LogSampleRateFromContext(ctx context.Context) (float64, bool) {
	if ctx == nil {
		return 0, false
	}
	v, ok := ctx.Value(ctxKeyLogSampleRate).(float64)
	return v, ok
}

// WithRouteID stashes the resolved Caddy route ID on ctx. Daemon
// middleware that knows the matched route attaches it here so log
// records (and downstream consumers like the audit emitter) carry
// the route binding.
func WithRouteID(ctx context.Context, id string) context.Context {
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, ctxKeyRouteID, id)
}

// RouteIDFromContext returns the route ID stored on ctx, or "".
func RouteIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(ctxKeyRouteID).(string)
	return id
}
