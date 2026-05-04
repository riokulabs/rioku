// Package strategies implements the v1 AI routing strategies for
// Sprint 5 Phase 3 (#168): simple_shuffle, fallback, and latency.
//
// The router lives daemon-side and decides which upstream provider
// (or model) handles a given AI request before Caddy reverse-proxies
// to it. v1 strategies are intentionally narrow per deep-dive 04;
// cost-based / capability-aware / CEL-driven routing is v2/v3.
//
// Strategy design — Strategy.Pick returns an ordered list of try
// candidates. The caller iterates this list, attempting each
// upstream in order; on a retry-trigger (e.g. 5xx for fallback) it
// moves on to the next. Stateful strategies (latency EWMA) update
// internal state via Observe.
package strategies

import (
	"errors"
	"fmt"
	"sync"
)

// Upstream is a candidate target the router considers for a request.
type Upstream struct {
	ID       string
	Weight   int // simple_shuffle: relative selection weight
	Priority int // fallback: lower wins
}

// Outcome is fed back to stateful strategies after each attempt.
type Outcome struct {
	UpstreamID string
	LatencyMS  int64
	Status     int // HTTP status; 0 means transport error
	Err        error
}

// Strategy returns an ordered try-list per request and consumes
// outcomes for state updates.
type Strategy interface {
	Name() string
	Pick(upstreams []Upstream) []Upstream
	Observe(o Outcome)
}

// ErrNoUpstreams is returned by helpers when given an empty list.
var ErrNoUpstreams = errors.New("strategies: no upstreams configured")

// TriggerSetter is satisfied by strategies that surface their
// fallback trigger list. The AI gateway uses this to consult the
// right trigger set without holding a concrete type — the
// fallback strategy is the canonical implementation but other
// strategies (or composites) can carry their own trigger sets.
type TriggerSetter interface {
	Triggers() []int
}

// FallbackTriggers is the default set of HTTP statuses that should
// advance the fallback chain to the next upstream. Operators can
// extend per-route via routing_config.
var FallbackTriggers = []int{408, 429, 500, 502, 503, 504}

// ShouldFallback reports whether the given outcome should trigger
// the fallback chain to advance. Transport errors (Status == 0
// with non-nil Err) always advance.
func ShouldFallback(o Outcome, triggers []int) bool {
	if o.Status == 0 && o.Err != nil {
		return true
	}
	for _, s := range triggers {
		if o.Status == s {
			return true
		}
	}
	return false
}

// Registry is the lookup table from strategy name to constructor.
// Keeping it a small in-process registry (vs DI) keeps the router
// callable from tests without wiring.
type Registry struct {
	mu          sync.RWMutex
	constructor map[string]func(config map[string]any) (Strategy, error)
}

// NewRegistry returns the default registry pre-populated with the
// three v1 strategies.
func NewRegistry() *Registry {
	r := &Registry{constructor: map[string]func(map[string]any) (Strategy, error){}}
	r.Register("simple_shuffle", func(_ map[string]any) (Strategy, error) {
		return NewSimpleShuffle(), nil
	})
	r.Register("fallback", func(cfg map[string]any) (Strategy, error) {
		return NewFallback(cfg), nil
	})
	r.Register("latency", func(cfg map[string]any) (Strategy, error) {
		return NewLatency(cfg), nil
	})
	return r
}

// Register adds or replaces a constructor under name.
func (r *Registry) Register(name string, ctor func(map[string]any) (Strategy, error)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.constructor[name] = ctor
}

// Build constructs a strategy by name with the given config map.
// Unknown names return an error rather than silently falling back —
// operators should see misconfiguration immediately.
func (r *Registry) Build(name string, cfg map[string]any) (Strategy, error) {
	r.mu.RLock()
	ctor, ok := r.constructor[name]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("strategies: unknown strategy %q", name)
	}
	return ctor(cfg)
}

// Names returns the registered strategy names (for admin REST
// /strategies discovery and CLI completion).
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.constructor))
	for n := range r.constructor {
		out = append(out, n)
	}
	return out
}
