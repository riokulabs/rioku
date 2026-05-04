package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestServicesRoutes_FullCRUD walks the tenant-scoped services
// surface end-to-end: create → get → list → patch → put → delete.
// Storage is the real sqlite driver via openTenantTestStore.
func TestServicesRoutes_FullCRUD(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterServicesRoutes(mux, drv)

	createBody := map[string]any{
		"name":     "backend-svc",
		"lbPolicy": "LB_POLICY_ROUND_ROBIN",
		"upstreams": []map[string]any{
			{"address": "127.0.0.1:8080", "weight": 1},
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
		t.Fatalf("created.id missing: %v", created)
	}
	if _, ok := created["_links"]; !ok {
		t.Errorf("created response should carry _links: %v", created)
	}

	// Get
	req = authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/services/"+id, "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d", rec.Code)
	}
	var got map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if got["name"] != "backend-svc" {
		t.Errorf("get.name = %v", got["name"])
	}

	// List
	req = authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/services", "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", rec.Code)
	}
	var listed map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&listed)
	if items, _ := listed["items"].([]any); len(items) < 1 {
		t.Errorf("list.items should be >= 1, got %v", listed["items"])
	}
	if _, ok := listed["_links"]; !ok {
		t.Errorf("list response should carry _links")
	}

	// PATCH (rename)
	req = authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/services/"+id, "default",
		map[string]any{"name": "backend-renamed"})
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch: expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var patched map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&patched)
	if patched["name"] != "backend-renamed" {
		t.Errorf("patched.name = %v", patched["name"])
	}

	// PUT (replace) — same body shape as create.
	req = authedTenantRequest(t, drv, http.MethodPut, "/api/v1/t/default/services/"+id, "default",
		map[string]any{
			"name":     "backend-put",
			"lbPolicy": "LB_POLICY_ROUND_ROBIN",
			"upstreams": []map[string]any{
				{"address": "127.0.0.1:8081", "weight": 2},
			},
		})
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("put: expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var puted map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&puted)
	if puted["name"] != "backend-put" {
		t.Errorf("puted.name = %v", puted["name"])
	}

	// Force-reload (stub returns 202).
	req = authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services/"+id+"/force-reload", "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("force-reload: expected 202, got %d body=%s", rec.Code, rec.Body.String())
	}

	// Delete
	req = authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/services/"+id, "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d", rec.Code)
	}

	// Get after delete -> 404.
	req = authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/services/"+id, "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("get-after-delete: expected 404, got %d", rec.Code)
	}
}

func TestServicesRoutes_OPTIONSCoverage(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterServicesRoutes(mux, drv)

	cases := []struct {
		path    string
		methods string
	}{
		{"/api/v1/t/default/services", "GET, OPTIONS, POST"},
		{"/api/v1/t/default/services/abc", "DELETE, GET, OPTIONS, PATCH, PUT"},
		{"/api/v1/t/default/services/abc/force-reload", "OPTIONS, POST"},
		{"/api/v1/t/default/services/abc/routes", "GET, OPTIONS"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodOptions, c.path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Errorf("%s: expected 204, got %d", c.path, rec.Code)
		}
		if got := rec.Header().Get("Allow"); got != c.methods {
			t.Errorf("%s: Allow = %q, want %q", c.path, got, c.methods)
		}
	}
}
