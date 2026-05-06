// Package gateway: Caddy reload hook.
//
// The real Caddy admin-API reload helper does not yet exist
// (decisions-needed.md item 005). To unblock testing of the contract that
// "every config-mutating handler triggers a reload", this file introduces
// a package-level injectable hook with a no-op default.
//
// Production wiring is unchanged: gateway handlers do not yet call the hook.
// The plan-03 integration test in `caddy_reload_integration_test.go` swaps
// in a counting hook to assert the reload contract from the test side.
//
// When the real helper lands (item 005), every Create/Update/Delete in
// services, routes, middlewares, sites, and access-policies should call
// `triggerCaddyReload(ctx, "<resource>")` after committing the
// transaction. The hook should debounce + deduplicate per its
// implementation (see decision item 005 alternatives).
package gateway

import (
	"context"
	"sync"
)

// CaddyReloadFunc is the signature of the reload hook. The `reason` is a
// short tag used for logging / metrics (e.g. "service.create").
type CaddyReloadFunc func(ctx context.Context, reason string)

var (
	caddyReloadMu   sync.RWMutex
	caddyReloadHook CaddyReloadFunc = func(context.Context, string) {} // no-op default
)

// SetCaddyReloadHook installs the reload hook. Tests use this to inject a
// counter; production wiring will install the real Caddy admin-API client.
//
// Returns the previous hook so callers can restore it (defer cleanup).
func SetCaddyReloadHook(hook CaddyReloadFunc) CaddyReloadFunc {
	caddyReloadMu.Lock()
	defer caddyReloadMu.Unlock()
	prev := caddyReloadHook
	if hook == nil {
		caddyReloadHook = func(context.Context, string) {}
	} else {
		caddyReloadHook = hook
	}
	return prev
}

// triggerCaddyReload invokes the current hook. Safe for concurrent use.
//
// Use this from any config-mutating handler after the transaction commits.
// Failure to reload is intentionally not propagated to the HTTP response —
// the persisted state is still authoritative; reload retry is owned by the
// helper implementation.
func triggerCaddyReload(ctx context.Context, reason string) {
	caddyReloadMu.RLock()
	hook := caddyReloadHook
	caddyReloadMu.RUnlock()
	hook(ctx, reason)
}
