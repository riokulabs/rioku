// Package gateway: Caddy reload hook.
//
// Every config-mutating handler (services / routes / middlewares / sites /
// access-policies) calls `triggerCaddyReload(ctx, "<resource>")` after the
// transaction commits. The hook is a package-level injectable function so:
//
//   - Tests can swap in a counting / recording hook to assert the contract.
//   - Production wires `NewCaddyAdminReloader` which compiles the current
//     config snapshot and POSTs it to the Caddy admin API at
//     `<admin_addr>/load`.
//
// Failure to reload is intentionally not propagated to the HTTP response —
// the persisted state is authoritative. The reloader logs and metrics-tags
// the failure; an out-of-band sync agent will retry.
package gateway

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// CaddyReloadFunc is the signature of the reload hook. The `reason` is a
// short tag used for logging / metrics (e.g. "service.create"). Hooks may
// return an error so settings handlers can surface a 500 to the caller
// when a reload fails (other handlers swallow the error and only log).
type CaddyReloadFunc func(ctx context.Context, reason string) error

var (
	caddyReloadMu   sync.RWMutex
	caddyReloadHook CaddyReloadFunc = func(context.Context, string) error { return nil } // no-op default
)

// SetCaddyReloadHook installs the reload hook. Tests use this to inject a
// counter; production wiring installs the real Caddy admin-API client via
// NewCaddyAdminReloader.
//
// Returns the previous hook so callers can restore it (defer cleanup).
func SetCaddyReloadHook(hook CaddyReloadFunc) CaddyReloadFunc {
	caddyReloadMu.Lock()
	defer caddyReloadMu.Unlock()
	prev := caddyReloadHook
	if hook == nil {
		caddyReloadHook = func(context.Context, string) error { return nil }
	} else {
		caddyReloadHook = hook
	}
	return prev
}

// triggerCaddyReload invokes the current hook. Safe for concurrent use.
//
// Use this from any config-mutating handler after the transaction commits.
// The error return lets settings handlers escalate to a 500 when a reload
// is mandatory; other callers may discard it.
func triggerCaddyReload(ctx context.Context, reason string) error {
	caddyReloadMu.RLock()
	hook := caddyReloadHook
	caddyReloadMu.RUnlock()
	return hook(ctx, reason)
}

// CaddyConfigCompiler is the minimal surface the reloader needs from the
// config engine: produce a fresh, full Caddy admin-API JSON document.
//
// This matches `*config.Engine.CompileCaddyConfig`. We accept the function
// type rather than the engine itself to keep this package free of an
// internal/config import (avoiding cycles) and to make the hook trivial to
// test with a stub.
type CaddyConfigCompiler func(ctx context.Context) ([]byte, error)

// CaddyReloaderConfig configures a real Caddy admin-API reload hook.
type CaddyReloaderConfig struct {
	// AdminURL is the base URL of the Caddy admin API, e.g.
	// "http://localhost:2019". No trailing slash.
	AdminURL string
	// Compile produces the latest compiled Caddy config JSON.
	Compile CaddyConfigCompiler
	// Client is the HTTP client used to POST. If nil a default is used.
	Client *http.Client
	// Logger is used for non-fatal failure logs. If nil, slog.Default().
	Logger *slog.Logger
}

// NewCaddyAdminReloader returns a CaddyReloadFunc that compiles the current
// config snapshot and POSTs it to `<AdminURL>/load`. Non-2xx responses are
// logged but never propagate.
//
// The returned hook is safe for concurrent use.
func NewCaddyAdminReloader(cfg CaddyReloaderConfig) CaddyReloadFunc {
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default() //nolint:forbidigo // hook init fallback when cfg.Logger nil
	}
	adminURL := cfg.AdminURL
	compile := cfg.Compile

	return func(ctx context.Context, reason string) error {
		if compile == nil || adminURL == "" {
			return nil
		}
		data, err := compile(ctx)
		if err != nil {
			logger.Warn("caddy reload: compile failed",
				"component", "gateway", "reason", reason, "error", err)
			return fmt.Errorf("compile: %w", err)
		}
		url := adminURL + "/load"
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
		if err != nil {
			logger.Warn("caddy reload: build request failed",
				"component", "gateway", "reason", reason, "error", err)
			return fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			logger.Warn("caddy reload: POST failed",
				"component", "gateway", "reason", reason, "error", err)
			return fmt.Errorf("post: %w", err)
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<14))
			err := fmt.Errorf("status %d", resp.StatusCode)
			logger.Warn("caddy reload: non-2xx response",
				"component", "gateway",
				"reason", reason,
				"status", resp.StatusCode,
				"body", string(body),
				"error", err)
			return err
		}
		return nil
	}
}
