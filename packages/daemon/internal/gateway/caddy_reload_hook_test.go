package gateway

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// TestCaddyReloadHook_NetworkPUTTriggersReload confirms a successful
// PUT /settings/network fires the gateway-side reload hook with the
// documented "settings.network" reason.
func TestCaddyReloadHook_NetworkPUTTriggersReload(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsConfigRoutes(mux, drv)

	var fired atomic.Int32
	var seenReason atomic.Value
	t.Cleanup(func() { SetCaddyReloadHook(nil) })
	SetCaddyReloadHook(func(_ context.Context, reason string) error {
		fired.Add(1)
		seenReason.Store(reason)
		return nil
	})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/settings/network", "default",
		map[string]any{
			"listenAddresses":     []string{":8080"},
			"http3Enabled":        false,
			"readTimeoutSeconds":  10,
			"writeTimeoutSeconds": 30,
			"idleTimeoutSeconds":  60,
		}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if fired.Load() != 1 {
		t.Errorf("hook fired %d times, want 1", fired.Load())
	}
	got, _ := seenReason.Load().(string)
	if got != "settings.network" {
		t.Errorf("reason = %q, want settings.network", got)
	}
}

// TestCaddyReloadHook_HookErrorIsBestEffort confirms an error from the
// reload hook does not surface back to the HTTP response — the network
// PUT succeeded and the request must reflect that.
func TestCaddyReloadHook_HookErrorIsBestEffort(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsConfigRoutes(mux, drv)

	t.Cleanup(func() { SetCaddyReloadHook(nil) })
	SetCaddyReloadHook(func(_ context.Context, _ string) error {
		return errReloadFailed
	})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/settings/network", "default",
		map[string]any{
			"listenAddresses":     []string{":8080"},
			"http3Enabled":        false,
			"readTimeoutSeconds":  10,
			"writeTimeoutSeconds": 30,
			"idleTimeoutSeconds":  60,
		}))
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 (hook errors must not surface to caller)", rec.Code)
	}
}

// errReloadFailed is a sentinel error used by hook-error tests.
var errReloadFailed = &reloadErr{msg: "synthetic reload failure"}

type reloadErr struct{ msg string }

func (e *reloadErr) Error() string { return e.msg }
