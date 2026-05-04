package strategies

import "sort"

// fallback is an ordered chain — try upstreams from lowest Priority
// to highest, advancing on retry-trigger statuses. Stateless across
// requests; the caller drives retries by walking the returned list.
type fallback struct {
	triggers []int
}

// NewFallback returns a Strategy that orders upstreams by Priority
// ascending. The optional config map may set "triggers" to a slice
// of HTTP status codes that should advance the chain. When the
// config is nil or omits the key, FallbackTriggers is used.
//
// Operators can opt to escalate on, say, 401 (auth misconfig) by
// adding it to the trigger list — but the default (timeout +
// rate-limit + 5xx) is what most setups want.
func NewFallback(cfg map[string]any) Strategy {
	tr := append([]int(nil), FallbackTriggers...)
	if cfg != nil {
		if raw, ok := cfg["triggers"]; ok {
			if list, ok := raw.([]any); ok {
				tr = tr[:0]
				for _, v := range list {
					if n, ok := toInt(v); ok {
						tr = append(tr, n)
					}
				}
			}
		}
	}
	return &fallback{triggers: tr}
}

func (f *fallback) Name() string { return "fallback" }

// Pick returns upstreams sorted by Priority ascending (lower first).
// Stable sort so two upstreams sharing a priority retain their
// declared order (operator intent: "if both fail, retry in this
// listed order").
func (f *fallback) Pick(upstreams []Upstream) []Upstream {
	if len(upstreams) == 0 {
		return nil
	}
	out := make([]Upstream, len(upstreams))
	copy(out, upstreams)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Priority < out[j].Priority })
	return out
}

// Observe is a no-op — fallback is stateless. Triggers live on
// the strategy and are consulted via ShouldFallback by the caller.
func (f *fallback) Observe(_ Outcome) {}

// Triggers exposes the configured trigger set (so the caller, the
// AI gateway, can call ShouldFallback with the right set without
// re-reading the config).
func (f *fallback) Triggers() []int { return f.triggers }

// toInt accepts the JSON-decoded number forms (json.Number, float64,
// int) the routing_config map can carry.
func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int32:
		return int(n), true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	}
	return 0, false
}
