// Package vault implements vault references for secret-bearing config
// fields. A vault reference is a string of the form
//
//	{vault://<backend>/<resource>}
//
// where <backend> identifies a registered Backend (e.g., "env", "file",
// "op") and <resource> is the backend-specific lookup key. The reference
// is stored verbatim at rest and on the admin REST surface — only the
// daemon's Caddy compile path (and a small set of explicitly-named
// callers, like the OTLP exporter) ever resolve it to plaintext.
//
// See contrib-docs/docs/decisions/2026-04-30-d12-vault-reference-resolution.md
// for the resolution-boundary decision.
package vault

import (
	"errors"
	"fmt"
	"strings"
)

// Sentinel errors. Unwrap-friendly so callers can distinguish "not a
// reference" (treat as literal) from "malformed reference" (reject).
var (
	// ErrNotReference is returned when the input string is not a vault
	// reference at all. Callers should treat the value as a literal.
	ErrNotReference = errors.New("vault: not a reference")

	// ErrMalformed is returned when a string starts and ends with the
	// reference delimiters but the inner shape is invalid.
	ErrMalformed = errors.New("vault: malformed reference")

	// ErrUnknownBackend is returned by a Resolver when no backend is
	// registered under the reference's backend name.
	ErrUnknownBackend = errors.New("vault: unknown backend")

	// ErrResolveFailed is returned when a backend reports an error
	// resolving a reference. Wrap with %w to preserve the underlying
	// cause for structured logs.
	ErrResolveFailed = errors.New("vault: resolve failed")
)

// Ref describes a parsed vault reference. The zero value is invalid;
// always obtain a Ref via Parse or MustParse.
type Ref struct {
	// Raw is the original reference string, including the wrapping
	// delimiters. Use this when round-tripping a reference back to
	// the admin REST layer or the config store.
	Raw string

	// Backend is the registered backend name (e.g., "env", "file",
	// "op", "vault", "aws-sm", "gcp-sm").
	Backend string

	// Resource is the backend-specific lookup key. For "env" this is
	// an environment variable name; for "file" this is a filesystem
	// path; for backends with a multi-segment lookup space (e.g.,
	// "op") this carries the full path verbatim.
	Resource string
}

// IsReference reports whether s syntactically looks like a vault
// reference (starts with "{vault://" and ends with "}"). It does not
// validate the inner shape — use Parse for that.
func IsReference(s string) bool {
	return strings.HasPrefix(s, "{vault://") && strings.HasSuffix(s, "}")
}

// Parse parses a single vault reference. The whole string must be the
// reference — embedded references inside larger strings are not
// supported in v1 (per the field-level semantics). If s is not a
// reference at all, Parse returns ErrNotReference; if s looks like a
// reference but is malformed (missing slash, empty backend, empty
// resource), Parse returns ErrMalformed.
func Parse(s string) (Ref, error) {
	if !IsReference(s) {
		return Ref{}, ErrNotReference
	}
	// Strip "{vault://" prefix and "}" suffix.
	inner := s[len("{vault://") : len(s)-1]
	// First "/" separates backend from resource. The resource may
	// contain further "/" characters (e.g., file paths, "op" item
	// paths) — only split on the first occurrence.
	idx := strings.IndexByte(inner, '/')
	if idx < 0 {
		return Ref{}, fmt.Errorf("%w: missing backend/resource separator in %q", ErrMalformed, s)
	}
	backend := inner[:idx]
	resource := inner[idx+1:]
	if backend == "" {
		return Ref{}, fmt.Errorf("%w: empty backend in %q", ErrMalformed, s)
	}
	if resource == "" {
		return Ref{}, fmt.Errorf("%w: empty resource in %q", ErrMalformed, s)
	}
	if !validBackendName(backend) {
		return Ref{}, fmt.Errorf("%w: invalid backend name %q", ErrMalformed, backend)
	}
	return Ref{Raw: s, Backend: backend, Resource: resource}, nil
}

// MustParse is the panicking variant of Parse. Intended for tests and
// constants — never use it on data that came from an admin or a
// config file.
func MustParse(s string) Ref {
	r, err := Parse(s)
	if err != nil {
		panic(err)
	}
	return r
}

// validBackendName enforces the same character class as proto-package
// names: ASCII letter followed by letters, digits, underscore, or
// hyphen. Keeps the surface narrow so we can extend the syntax later
// without ambiguity.
func validBackendName(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z':
		case c >= 'A' && c <= 'Z':
		case i > 0 && (c >= '0' && c <= '9' || c == '_' || c == '-'):
		default:
			return false
		}
	}
	return true
}
