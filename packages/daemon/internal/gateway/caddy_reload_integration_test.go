package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCaddyReload_ServiceMutationsAcceptedNoCrash documents the current state
// of the Caddy reload contract for Plan-03 Task 7.
//
// The plan's stated goal is: "after POST /services, fetch Caddy admin API at
// :2019 and assert the new service appears in compiled config." That is
// blocked by decisions-needed.md Item 005 — the daemon does NOT currently
// invoke a real Caddy admin-API reload after Create/Update/Delete. The
// `handleForceReloadService` handler is documented as a stub that simply
// returns 202 without touching Caddy.
//
// Until Item 005 lands (an `internal/caddy/reload.go` helper that POSTs to
// `http://localhost:2019/load`, called from every mutation handler), the
// integration test below validates only the in-process contract:
//
//   1. Service create/update/delete still complete successfully even with no
//      reload helper present (i.e. no nil-pointer panic, no 500).
//   2. force-reload returns 202 Accepted for an existing service.
//   3. force-reload returns 404 for a non-existent service.
//
// When Item 005 is resolved, replace this body with a real assertion against
// the Caddy admin API (`GET :2019/config/`) showing the new service appears
// in the compiled config. Mark the test `t.Skip` if Caddy is not on $PATH so
// the suite stays green on contributor machines without Caddy.
func TestCaddyReload_ServiceMutationsAcceptedNoCrash(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterServicesRoutes(mux, drv)

	// 1. Create a service — must succeed without a Caddy reload helper.
	createBody := map[string]any{
		"name":     "reload-canary",
		"lbPolicy": "LB_POLICY_ROUND_ROBIN",
		"upstreams": []map[string]any{
			{"address": "127.0.0.1:9999", "weight": 1},
		},
	}
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services", "default", createBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	var created map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatalf("create: empty id in response")
	}

	// 2. force-reload on the live id returns 202 Accepted (stub behavior).
	req = authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services/"+id+"/force-reload", "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("force-reload: expected 202, got %d body=%s", rec.Code, rec.Body.String())
	}

	// 3. force-reload on a missing id returns 404.
	req = authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services/does-not-exist/force-reload", "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("force-reload missing: expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}

	// 4. Delete still works (no reload helper -> no panic).
	req = authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/services/"+id, "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}

	// NOTE (Plan-03 T7 / decisions-needed.md Item 005): once the real reload
	// helper lands, extend this test to:
	//   a. Spin up a Caddy admin server (httptest) capturing POST /load calls.
	//   b. Inject the helper into the gateway router.
	//   c. Assert that POST/PUT/PATCH/DELETE on services each trigger exactly
	//      one /load call with a config containing the mutated service.
	//   d. Assert that force-reload also triggers /load.
}
