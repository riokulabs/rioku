package vault

import "context"

// Backend resolves vault references for a single backend name. Backends
// are stateless from the caller's perspective; any caching, connection
// pooling, or rotation lives inside the implementation.
//
// Resolve must be safe for concurrent use. Implementations should
// return a distinct error wrapping ErrResolveFailed when the lookup
// fails so callers can produce structured logs without leaking the
// resolved value into the error string.
type Backend interface {
	// Name is the registered backend name (e.g., "env", "file"). It
	// must match the Backend field on the Ref values this backend
	// will receive.
	Name() string

	// Sync reports whether Resolve completes without network IO and
	// without blocking on slow disk paths. The startup compile uses
	// this to decide whether a missing reference fails the boot or
	// degrades to "keep previous Caddy config running, log the
	// failure, retry on the next compile". Env-backed refs are sync;
	// HCV / AWS-SM / GCP-SM are not.
	Sync() bool

	// Resolve looks up resource on this backend and returns the
	// plaintext secret. Implementations must not log, audit, or
	// otherwise side-channel the returned value.
	Resolve(ctx context.Context, resource string) (string, error)
}
