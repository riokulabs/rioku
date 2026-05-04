package vault

import (
	"context"
	"fmt"
	"os"
)

// EnvBackend resolves references via process environment variables.
// Reference syntax: {vault://env/<VAR_NAME>}.
//
// EnvBackend is sync — Resolve does no IO beyond a getenv call. This
// makes it safe for the daemon's startup compile path (no network
// dependency, no blocking).
type EnvBackend struct{}

// NewEnvBackend constructs a new env-backed Backend. The zero value
// of EnvBackend is also valid; the constructor is provided for
// symmetry with the other backends.
func NewEnvBackend() *EnvBackend { return &EnvBackend{} }

// Name returns "env".
func (*EnvBackend) Name() string { return "env" }

// Sync returns true — env lookups never block.
func (*EnvBackend) Sync() bool { return true }

// Resolve returns the value of the named environment variable. An
// unset variable is reported as ErrResolveFailed; the empty string
// is returned for variables that are set to "".
func (*EnvBackend) Resolve(_ context.Context, resource string) (string, error) {
	value, ok := os.LookupEnv(resource)
	if !ok {
		return "", fmt.Errorf("%w: env var %q not set", ErrResolveFailed, resource)
	}
	return value, nil
}
