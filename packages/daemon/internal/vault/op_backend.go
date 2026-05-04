package vault

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// OnePasswordBackend resolves references via the 1Password CLI (`op`).
// Reference syntax: {vault://op/<vault>/<item>/<field>} — the resource
// segment is passed verbatim to `op read op://<resource>`.
//
// The plan treats this backend as `file://` shaped indirection: the
// secret lives in 1Password, the daemon reads it once per cache TTL
// via the operator-installed CLI, and the plaintext never leaves the
// daemon process. The CLI handles authentication itself (typically
// via a session token populated by `op signin` or by a Connect
// service-account environment variable like OP_SERVICE_ACCOUNT_TOKEN).
//
// OnePasswordBackend is **not** Sync — `op read` shells out to a
// subprocess and may make a network call. Treat it like an HCV-style
// backend for init-phase ordering: a failed resolve at startup
// should not block the previous Caddy config from continuing to run.
type OnePasswordBackend struct {
	// Binary is the `op` executable path. Empty means resolve via
	// $PATH at first call; pin this to an explicit path on
	// production hosts.
	Binary string

	// Timeout caps each `op read` invocation. Defaults to 10s when
	// zero. The CLI is generally fast (< 500 ms once authenticated)
	// but a stalled session token can hang.
	Timeout time.Duration

	// Env, when non-nil, overrides the subprocess environment.
	// Useful for OP_SERVICE_ACCOUNT_TOKEN propagation in
	// containerised deployments where the daemon does not inherit
	// shell env. The empty default inherits the daemon's env.
	Env []string
}

// NewOnePasswordBackend constructs a default OnePasswordBackend
// resolved against $PATH with a 10s timeout. Field overrides on the
// returned struct are honoured.
func NewOnePasswordBackend() *OnePasswordBackend {
	return &OnePasswordBackend{Timeout: 10 * time.Second}
}

// Name returns "op".
func (*OnePasswordBackend) Name() string { return "op" }

// Sync returns false — the CLI shells out and may make a network
// call. Callers should not block startup compile on this backend.
func (*OnePasswordBackend) Sync() bool { return false }

// Resolve invokes `op read op://<resource>` and returns the captured
// stdout (with one trailing newline stripped). Any non-zero exit or
// timeout surfaces ErrResolveFailed.
func (b *OnePasswordBackend) Resolve(ctx context.Context, resource string) (string, error) {
	if resource == "" {
		return "", fmt.Errorf("%w: empty op resource", ErrResolveFailed)
	}
	binary := b.Binary
	if binary == "" {
		binary = "op"
	}
	timeout := b.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	subCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	uri := "op://" + resource

	cmd := exec.CommandContext(subCtx, binary, "read", uri)
	if b.Env != nil {
		cmd.Env = b.Env
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Don't leak stderr verbatim — `op` is well-behaved but a
		// future version might echo the requested item path or
		// part of a value. Surface a stable, non-leaking message.
		return "", fmt.Errorf("%w: op read %q failed: %v (exit code-only; stderr suppressed for safety)",
			ErrResolveFailed, uri, err)
	}

	out := strings.TrimSuffix(stdout.String(), "\n")
	if out == "" {
		return "", fmt.Errorf("%w: op read %q returned empty value", ErrResolveFailed, uri)
	}
	return out, nil
}
