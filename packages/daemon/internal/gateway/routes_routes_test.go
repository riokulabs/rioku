package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// TestRoutesRoutes_FullCRUDPlusPolicyAttach exercises the new
// tenant-scoped routes surface: create → list → patch → policy attach
// + detach → delete.
func TestRoutesRoutes_FullCRUDPlusPolicyAttach(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterServicesRoutes(mux, drv) // for the underlying svc the route targets
	RegisterRoutesRoutes(mux, drv)

	// Seed a service the route can target.
	svcReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services", "default",
		map[string]any{
			"name":     "svc-for-route",
			"lbPolicy": "LB_POLICY_ROUND_ROBIN",
			"upstreams": []map[string]any{
				{"address": "127.0.0.1:8000"},
			},
		})
	svcRec := httptest.NewRecorder()
	mux.ServeHTTP(svcRec, svcReq)
	if svcRec.Code != http.StatusCreated {
		t.Fatalf("seed service: %d %s", svcRec.Code, svcRec.Body.String())
	}
	var svc map[string]any
	_ = json.NewDecoder(svcRec.Body).Decode(&svc)
	svcID := svc["id"].(string)

	// Create route targeting that service.
	createBody := map[string]any{
		"name":      "homepage",
		"enabled":   true,
		"serviceId": svcID,
		"matchers": []map[string]any{
			{"hosts": []string{"example.com"}},
		},
	}
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/routes", "default", createBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create route: expected 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	var created map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&created)
	id := created["id"].(string)

	// _links should include service.
	if l, _ := created["_links"].(map[string]any); l == nil || l["service"] == nil {
		t.Errorf("created._links.service missing: %v", created["_links"])
	}

	// List
	req = authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/routes", "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d", rec.Code)
	}

	// Sub-collection: services/{id}/routes should include this route.
	req = authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/services/"+svcID+"/routes", "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list-by-service: %d", rec.Code)
	}
	var sub map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&sub)
	if items, _ := sub["items"].([]any); len(items) < 1 {
		t.Errorf("services/{id}/routes should list the route, got %v", items)
	}

	// PATCH the route (rename).
	req = authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/routes/"+id, "default",
		map[string]any{"name": "homepage-renamed"})
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch: %d body=%s", rec.Code, rec.Body.String())
	}

	// Seed a legacy Policy (rate-limit type) directly via storage.
	// route policy_bindings reference the legacy `policies` table
	// (Caddy-handler config blobs) rather than the newer access_policies
	// table. The /routes/{id}/policies/{policyId} attach surface uses
	// the legacy binding.
	tx, _ := drv.Begin(context.Background(), store.TxOptions{})
	pol, err := tx.CreatePolicy(context.Background(), &riokuv1.Policy{
		Name: "rl-default",
		Type: riokuv1.PolicyType_POLICY_TYPE_RATE_LIMIT,
	})
	if err != nil {
		t.Fatalf("seed policy: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit seed policy: %v", err)
	}
	polID := pol.GetId()

	// Attach
	req = authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/routes/"+id+"/policies/"+polID, "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("attach: %d %s", rec.Code, rec.Body.String())
	}

	// List bound policies
	req = authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/routes/"+id+"/policies", "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list-policies: %d", rec.Code)
	}
	var policies map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&policies)
	items, _ := policies["items"].([]any)
	if len(items) != 1 {
		t.Errorf("expected 1 attached policy, got %d", len(items))
	}

	// Detach
	req = authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/routes/"+id+"/policies/"+polID, "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("detach: %d", rec.Code)
	}

	// Delete the route.
	req = authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/routes/"+id, "default", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
}

func TestRoutesRoutes_OPTIONSCoverage(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterRoutesRoutes(mux, drv)

	cases := []struct {
		path    string
		methods string
	}{
		{"/api/v1/t/default/routes", "GET, OPTIONS, POST"},
		{"/api/v1/t/default/routes/abc", "DELETE, GET, OPTIONS, PATCH, PUT"},
		{"/api/v1/t/default/routes/abc/policies", "GET, OPTIONS"},
		{"/api/v1/t/default/routes/abc/policies/p1", "DELETE, OPTIONS, POST"},
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
