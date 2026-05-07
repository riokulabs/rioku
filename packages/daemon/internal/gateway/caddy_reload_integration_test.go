package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/riokulabs/rioku/internal/store"
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
	prev := SetCaddyReloadHook(func(_ context.Context, reason string) error {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, call{reason: reason})
		return nil
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

// TestCaddyReload_AdminClient_PostsLoadOnMutation asserts the contract of
// Plan-03 Task 7: the production reload hook compiles the current Caddy
// config and POSTs it to `<admin>/load` after each mutating REST call,
// and that the new entity is visible in the JSON sent on the wire.
//
// The test stands up an httptest.Server acting as the Caddy admin API
// (capturing every request body), wires `NewCaddyAdminReloader` against
// it with a stub compiler, and exercises a service create. The stub
// compiler returns a payload that reflects the latest stored services so
// we can assert the new service appears in the compiled output that
// reached the "Caddy admin" stub.
func TestCaddyReload_AdminClient_PostsLoadOnMutation(t *testing.T) {
	type capture struct {
		method      string
		path        string
		contentType string
		body        []byte
	}
	var (
		mu       sync.Mutex
		captured []capture
	)

	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		captured = append(captured, capture{
			method:      r.Method,
			path:        r.URL.Path,
			contentType: r.Header.Get("Content-Type"),
			body:        body,
		})
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(stub.Close)

	drv := openTenantTestStore(t)

	// Stub compiler: emits a JSON document containing the names of every
	// service currently in the store under the default tenant. This lets
	// the test assert that a freshly-created service appears in what the
	// admin client POSTed (i.e. the reload reflects post-commit state).
	compile := func(ctx context.Context) ([]byte, error) {
		// Mirror what the real engine would compile after the mutation
		// commits: read every service from the store and emit their
		// names so the test can assert the post-commit state was sent
		// to the admin API.
		tx, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return nil, err
		}
		defer func() { _ = tx.Rollback() }()
		svcs, err := tx.ListServices(ctx)
		if err != nil {
			return nil, err
		}
		names := make([]string, 0, len(svcs))
		for _, s := range svcs {
			names = append(names, s.GetName())
		}
		return json.Marshal(map[string]any{
			"apps": map[string]any{
				"http": map[string]any{
					"services": names,
				},
			},
		})
	}

	prev := SetCaddyReloadHook(NewCaddyAdminReloader(CaddyReloaderConfig{
		AdminURL: stub.URL,
		Compile:  compile,
	}))
	t.Cleanup(func() { SetCaddyReloadHook(prev) })

	mux := http.NewServeMux()
	RegisterServicesRoutes(mux, drv)

	// Create a service and assert the stub received a POST /load whose
	// body reflects the new entity.
	body := map[string]any{
		"name":     "svc-reload-canary",
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

	mu.Lock()
	defer mu.Unlock()
	if len(captured) == 0 {
		t.Fatalf("expected at least one POST to the Caddy admin stub, got 0")
	}
	last := captured[len(captured)-1]
	if last.method != http.MethodPost {
		t.Errorf("method = %q, want POST", last.method)
	}
	if last.path != "/load" {
		t.Errorf("path = %q, want /load", last.path)
	}
	if last.contentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", last.contentType)
	}
	if !bytes.Contains(last.body, []byte("svc-reload-canary")) {
		t.Errorf("posted body does not contain the new service name; body=%s", string(last.body))
	}
	// Verify the body parses as JSON (i.e. the admin client preserved
	// JSON encoding rather than corrupting the payload).
	var doc map[string]any
	if err := json.Unmarshal(last.body, &doc); err != nil {
		t.Errorf("posted body is not valid JSON: %v", err)
	}
}

// TestCaddyReload_AdminClient_NonOKResponseDoesNotPropagate asserts that a
// 5xx from the Caddy admin API is logged but does not break the REST
// response — the persisted state is authoritative.
func TestCaddyReload_AdminClient_NonOKResponseDoesNotPropagate(t *testing.T) {
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(stub.Close)

	drv := openTenantTestStore(t)

	prev := SetCaddyReloadHook(NewCaddyAdminReloader(CaddyReloaderConfig{
		AdminURL: stub.URL,
		Compile: func(_ context.Context) ([]byte, error) {
			return []byte(`{"apps":{}}`), nil
		},
	}))
	t.Cleanup(func() { SetCaddyReloadHook(prev) })

	mux := http.NewServeMux()
	RegisterServicesRoutes(mux, drv)

	body := map[string]any{
		"name":     "svc-failure-canary",
		"lbPolicy": "LB_POLICY_ROUND_ROBIN",
		"upstreams": []map[string]any{
			{"address": "127.0.0.1:9999", "weight": 1},
		},
	}
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services", "default", body)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create with failing reload: %d %s", rec.Code, rec.Body.String())
	}
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
