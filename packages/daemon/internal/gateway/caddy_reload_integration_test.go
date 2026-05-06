package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// TestCaddyReload_HookIsInvokedOnEveryMutation asserts the contract of
// Plan-03 Task 7 / decisions-needed.md item 005:
//
//	"every config-mutating handler triggers a Caddy reload after the
//	 transaction commits."
//
// The handlers call `triggerCaddyReload(ctx, reason)` (see
// `caddy_reload_hook.go`). The production hook is a no-op pending the real
// Caddy admin-API client (item 005). In tests we swap in a counting hook
// via `SetCaddyReloadHook`, exercise the four mutating verbs on services,
// middlewares, and sites, and assert that each verb increments the counter
// exactly once with the expected reason tag.
//
// When the real helper lands, this test should keep working — only the
// production wiring of the hook needs to change.
func TestCaddyReload_HookIsInvokedOnEveryMutation(t *testing.T) {
	type call struct {
		reason string
	}
	var (
		mu    sync.Mutex
		calls []call
	)
	prev := SetCaddyReloadHook(func(_ context.Context, reason string) {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, call{reason: reason})
	})
	t.Cleanup(func() { SetCaddyReloadHook(prev) })

	reset := func() {
		mu.Lock()
		defer mu.Unlock()
		calls = calls[:0]
	}
	reasons := func() []string {
		mu.Lock()
		defer mu.Unlock()
		out := make([]string, len(calls))
		for i, c := range calls {
			out[i] = c.reason
		}
		return out
	}

	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterServicesRoutes(mux, drv)
	RegisterMiddlewareRoutes(mux, drv)
	RegisterSiteRoutes(mux, drv)

	// ─── Services: create / update / force-reload / delete ────────────────────
	t.Run("services lifecycle triggers reloads", func(t *testing.T) {
		reset()

		// Create
		body := map[string]any{
			"name":     "svc-canary",
			"lbPolicy": "LB_POLICY_ROUND_ROBIN",
			"upstreams": []map[string]any{
				{"address": "127.0.0.1:9999", "weight": 1},
			},
		}
		req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services", "default", body)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		var created map[string]any
		_ = json.NewDecoder(rec.Body).Decode(&created)
		id, _ := created["id"].(string)
		if id == "" {
			t.Fatalf("missing id")
		}

		// Update (PATCH)
		req = authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/services/"+id, "default",
			map[string]any{"name": "svc-canary-2"})
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
		}

		// Force-reload
		req = authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services/"+id+"/force-reload", "default", nil)
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("force-reload: %d %s", rec.Code, rec.Body.String())
		}

		// Delete
		req = authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/services/"+id, "default", nil)
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
		}

		got := reasons()
		want := []string{"service.create", "service.update", "service.force-reload", "service.delete"}
		if !equalStrSlice(got, want) {
			t.Errorf("reasons = %v, want %v", got, want)
		}
	})

	// ─── Middlewares: create / update / delete ────────────────────────────────
	t.Run("middlewares lifecycle triggers reloads", func(t *testing.T) {
		reset()

		req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/middlewares", "default",
			map[string]any{"name": "mw-canary", "kind": "rate-limit"})
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		var created map[string]any
		_ = json.NewDecoder(rec.Body).Decode(&created)
		id, _ := created["id"].(string)

		req = authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/middlewares/"+id, "default",
			map[string]any{"name": "mw-canary-2"})
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
		}

		req = authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/middlewares/"+id, "default", nil)
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
		}

		got := reasons()
		want := []string{"middleware.create", "middleware.update", "middleware.delete"}
		if !equalStrSlice(got, want) {
			t.Errorf("reasons = %v, want %v", got, want)
		}
	})

	// ─── Sites: create / update / toggle / delete ─────────────────────────────
	t.Run("sites lifecycle triggers reloads", func(t *testing.T) {
		reset()

		req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/sites", "default",
			map[string]any{"name": "site-canary", "domain": "canary.example.com"})
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		var created map[string]any
		_ = json.NewDecoder(rec.Body).Decode(&created)
		id, _ := created["id"].(string)

		req = authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/sites/"+id, "default",
			map[string]any{"name": "site-canary-2"})
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
		}

		req = authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/sites/"+id+"/enabled", "default",
			map[string]any{"enabled": false})
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("toggle: %d %s", rec.Code, rec.Body.String())
		}

		req = authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/sites/"+id, "default", nil)
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
		}

		got := reasons()
		want := []string{"site.create", "site.update", "site.toggle", "site.delete"}
		if !equalStrSlice(got, want) {
			t.Errorf("reasons = %v, want %v", got, want)
		}
	})

	// ─── Negative case: 404s do NOT trigger a reload ──────────────────────────
	t.Run("not-found does not trigger reload", func(t *testing.T) {
		reset()
		req := authedTenantRequest(t, drv, http.MethodPost,
			"/api/v1/t/default/services/does-not-exist/force-reload", "default", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", rec.Code)
		}
		if got := reasons(); len(got) != 0 {
			t.Errorf("reload calls on 404 path = %v, want none", got)
		}
	})
}

func equalStrSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
