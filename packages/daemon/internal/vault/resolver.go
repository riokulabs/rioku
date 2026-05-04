package vault

import (
	"context"
	"fmt"
	"sync"
)

// Resolver dispatches a Ref to its registered Backend.
//
// Resolver is the only entry point that callers (Caddy compiler,
// OTLP exporter init, etc.) should use to obtain plaintext. It is
// safe for concurrent use after construction.
//
// In v1 Resolver does no caching of its own — see the resolverCache
// decorator in cache.go for that. Keeping the registry split from
// the cache lets us swap caching strategies without touching the
// dispatch path.
type Resolver struct {
	mu       sync.RWMutex
	backends map[string]Backend
}

// NewResolver constructs an empty Resolver. Use Register to install
// backends after construction; backends can be added or replaced at
// runtime, but typical operators register everything at startup.
func NewResolver() *Resolver {
	return &Resolver{backends: make(map[string]Backend)}
}

// Register installs b under its declared Name. A nil backend is
// rejected; a duplicate name replaces the previous binding (last
// writer wins). Returns the previous backend, if any, so callers
// can swap-and-restore in tests.
func (r *Resolver) Register(b Backend) Backend {
	if b == nil {
		panic("vault: cannot register nil Backend")
	}
	name := b.Name()
	if name == "" {
		panic("vault: backend Name() returned empty string")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	prev := r.backends[name]
	r.backends[name] = b
	return prev
}

// Backend returns the registered backend for the named key, or nil
// when no backend is registered. Useful for callers (init checks,
// tests) that want to verify configuration before resolution.
func (r *Resolver) Backend(name string) Backend {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.backends[name]
}

// Resolve dispatches ref to its registered Backend and returns the
// plaintext secret. ErrUnknownBackend is returned when no backend
// matches the ref's name; ErrResolveFailed wraps the backend's
// underlying error otherwise.
func (r *Resolver) Resolve(ctx context.Context, ref Ref) (string, error) {
	b := r.Backend(ref.Backend)
	if b == nil {
		return "", fmt.Errorf("%w: %q (resource=%q)", ErrUnknownBackend, ref.Backend, ref.Resource)
	}
	return b.Resolve(ctx, ref.Resource)
}

// ResolveString accepts an arbitrary string. When the string is a
// vault reference it is parsed and dispatched; otherwise the literal
// value is returned unchanged. This is the convenience helper most
// callers want — it lets the same code path handle both
// "{vault://env/X}" and a plain literal value without branching.
func (r *Resolver) ResolveString(ctx context.Context, s string) (string, error) {
	if !IsReference(s) {
		return s, nil
	}
	ref, err := Parse(s)
	if err != nil {
		return "", err
	}
	return r.Resolve(ctx, ref)
}

// ResolveAll resolves every reference in values, returning a map of
// resolved plaintext keyed by the same map keys. The semantics are
// all-or-nothing — if any reference fails to resolve, no map is
// returned and the first error is reported. This satisfies the
// "multi-secret atomicity" trip-wire from deep-dive 03: a partial
// resolve must not produce a half-configured Caddy compile.
func (r *Resolver) ResolveAll(ctx context.Context, values map[string]string) (map[string]string, error) {
	out := make(map[string]string, len(values))
	for k, raw := range values {
		v, err := r.ResolveString(ctx, raw)
		if err != nil {
			return nil, fmt.Errorf("vault: resolve %q: %w", k, err)
		}
		out[k] = v
	}
	return out, nil
}

// Preflight validates a candidate secret value at admin-write time
// without retaining the resolved plaintext (#190). When s is a
// vault:// reference, the function parses it and attempts a one-shot
// resolve; the resolved value is discarded immediately. Plain-text
// values pass through with err == nil. The point is to surface
// "secret not configured" / "wrong backend" failures during the
// admin REST write itself rather than at compile time when the
// daemon would 500 in a less obvious place.
//
// Resolver may be nil — in that case Preflight only validates the
// reference syntax. This keeps the helper usable in environments
// where the resolver hasn't been wired (e.g. early test scaffolds).
func (r *Resolver) Preflight(ctx context.Context, s string) error {
	if !IsReference(s) {
		return nil
	}
	ref, err := Parse(s)
	if err != nil {
		return err
	}
	if r == nil {
		// Resolver not wired — accept the syntactic validation only.
		return nil
	}
	if _, err := r.Resolve(ctx, ref); err != nil {
		return err
	}
	return nil
}
