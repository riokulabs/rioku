// Package gateway: Caddy reload hook (#191 / Plan 03 follow-up).
//
// Several settings mutations (network listen-address changes, manual TLS
// cert upload/delete, ACME provider changes) require the gateway to nudge
// the live Caddy admin API into reloading its config from the daemon's
// store. The actual reload mechanic lives in `internal/caddy` and is
// wired up by the daemon `cmd/rioku` layer; this file only carries a
// process-global registry so individual REST handlers can fire-and-forget
// "please reload" notifications without taking a hard import dependency
// on the caddy supervisor.
//
// Design:
//   - SetCaddyReloadHook is called once at daemon startup.
//   - Handlers call triggerCaddyReload(ctx, reason); the call is non-
//     blocking from the handler's perspective (errors are logged but
//     never propagate back to the HTTP response — the store mutation
//     already succeeded by the time this fires).
//   - When the hook is unset (tests, CLI sub-commands without a Caddy
//     supervisor) triggerCaddyReload is a no-op.
package gateway

import (
	"context"
	"log/slog"
	"sync"
)

// CaddyReloadFunc is invoked from settings handlers after a mutation that
// requires a Caddy admin-API reload. The reason argument is included in the
// daemon log line so operators can correlate reloads with audit events.
type CaddyReloadFunc func(ctx context.Context, reason string) error

var (
	caddyReloadMu   sync.RWMutex
	caddyReloadHook CaddyReloadFunc
)

// SetCaddyReloadHook registers the process-wide reload notifier. Pass nil to
// clear the hook (test cleanup).
func SetCaddyReloadHook(fn CaddyReloadFunc) {
	caddyReloadMu.Lock()
	defer caddyReloadMu.Unlock()
	caddyReloadHook = fn
}

// triggerCaddyReload invokes the registered reload hook (if any). Errors are
// logged at warn level but never propagate — the store mutation that
// triggered the reload has already succeeded by the time we get here, and a
// failed reload is an operational issue not a request-level failure.
func triggerCaddyReload(ctx context.Context, reason string) {
	caddyReloadMu.RLock()
	fn := caddyReloadHook
	caddyReloadMu.RUnlock()
	if fn == nil {
		return
	}
	if err := fn(ctx, reason); err != nil {
		slog.Warn("caddy reload trigger failed",
			"component", "gateway",
			"reason", reason,
			"error", err)
	}
}
