package strategies

import (
	"sort"
	"sync"
)

// latency is EWMA-based — pick the upstream with the lowest moving-
// average latency. Stateful across requests; mutates per Observe.
//
// EWMA: avg' = decay * avg + (1-decay) * sample
// decay default 0.8 (config key "decay"). Higher decay = slower to
// react to a single fast/slow sample.
type latency struct {
	mu    sync.RWMutex
	ewma  map[string]float64 // upstream id -> EWMA in ms
	decay float64
}

// NewLatency returns a stateful EWMA-driven Strategy. The optional
// config map may set "decay" (float in (0,1)) — higher = smoother.
//
// On a fresh router with no observations the strategy returns the
// upstreams in declared order — there's no signal yet to bias on.
// First few requests therefore behave like fallback's natural order
// and EWMA fills in as outcomes flow through Observe.
func NewLatency(cfg map[string]any) Strategy {
	d := 0.8
	if cfg != nil {
		if raw, ok := cfg["decay"]; ok {
			if f, ok := raw.(float64); ok && f > 0 && f < 1 {
				d = f
			}
		}
	}
	return &latency{
		ewma:  map[string]float64{},
		decay: d,
	}
}

func (l *latency) Name() string { return "latency" }

// Pick returns upstreams sorted ascending by EWMA (lowest = fastest).
// Upstreams that have no observation yet sort last (their avg is
// treated as +inf relative to peers) — once they get a sample they
// move in.
func (l *latency) Pick(upstreams []Upstream) []Upstream {
	if len(upstreams) == 0 {
		return nil
	}
	l.mu.RLock()
	snap := make(map[string]float64, len(l.ewma))
	for k, v := range l.ewma {
		snap[k] = v
	}
	l.mu.RUnlock()

	out := make([]Upstream, len(upstreams))
	copy(out, upstreams)
	sort.SliceStable(out, func(i, j int) bool {
		ai, aok := snap[out[i].ID]
		bj, bok := snap[out[j].ID]
		switch {
		case aok && !bok:
			return true
		case !aok && bok:
			return false
		case !aok && !bok:
			return false // equal — preserve declared order via stable sort
		default:
			return ai < bj
		}
	})
	return out
}

// Observe folds a new latency sample into the upstream's EWMA.
// Transport errors (Status == 0 with Err) are treated as a worst-
// case sample (1500ms) so a flapping provider drifts to the back of
// the queue rather than getting silently ignored.
func (l *latency) Observe(o Outcome) {
	if o.UpstreamID == "" {
		return
	}
	sample := float64(o.LatencyMS)
	if o.Status == 0 && o.Err != nil {
		sample = 1500
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if cur, ok := l.ewma[o.UpstreamID]; ok {
		l.ewma[o.UpstreamID] = l.decay*cur + (1-l.decay)*sample
	} else {
		// First sample seeds the EWMA directly.
		l.ewma[o.UpstreamID] = sample
	}
}

// Snapshot returns a copy of the current EWMA map. Useful for
// admin-level introspection (REST: GET .../strategy/latency/state).
func (l *latency) Snapshot() map[string]float64 {
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make(map[string]float64, len(l.ewma))
	for k, v := range l.ewma {
		out[k] = v
	}
	return out
}
