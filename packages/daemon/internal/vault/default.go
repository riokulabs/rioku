package vault

import "time"

// DefaultOptions configures the default Resolver constructed by
// Default() and DefaultCaching(). Zero values give safe defaults:
// empty FileRoot disables the file-backend root jail, zero
// CacheTTL disables caching, zero RotationInterval disables rotation.
type DefaultOptions struct {
	// FileRoot pins file:// references to a single directory tree.
	// Empty allows any absolute path (operator trust mode). Strongly
	// recommended in production deployments.
	FileRoot string

	// OpBinary is the absolute path to the 1Password CLI. Empty
	// resolves "op" via $PATH at first call.
	OpBinary string

	// OpTimeout caps each `op read` invocation. Zero means use the
	// backend's own default (10s).
	OpTimeout time.Duration

	// CacheTTL is the TTL of the wrapping CachingResolver. Zero
	// disables caching entirely (every Resolve hits the backend).
	CacheTTL time.Duration

	// RotationInterval is the cache-flush cadence. Zero disables the
	// rotation timer; callers can still flush explicitly.
	RotationInterval time.Duration
}

// Default returns a Resolver with the standard v1 backends registered:
// env, file (with optional root jail), and op (1Password CLI).
//
// The returned Resolver is the bare dispatcher — no caching, no
// rotation. Use DefaultCaching for the production wiring.
func Default(opts DefaultOptions) *Resolver {
	r := NewResolver()
	r.Register(NewEnvBackend())
	r.Register(NewFileBackend(opts.FileRoot))
	op := NewOnePasswordBackend()
	if opts.OpBinary != "" {
		op.Binary = opts.OpBinary
	}
	if opts.OpTimeout > 0 {
		op.Timeout = opts.OpTimeout
	}
	r.Register(op)
	return r
}

// DefaultCaching returns a CachingResolver wrapping Default(). When
// CacheTTL is zero the wrapper still exists but caching is disabled
// — that keeps the API surface uniform for callers that want a
// caching resolver type even in development. RotationInterval is
// applied via a separate goroutine the caller starts with
// CachingResolver.RotationLoop.
func DefaultCaching(opts DefaultOptions) *CachingResolver {
	return NewCachingResolver(Default(opts), opts.CacheTTL)
}
