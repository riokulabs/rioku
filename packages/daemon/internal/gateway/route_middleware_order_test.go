package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestRouteMiddlewareOrder_PutSetsLabel verifies the dedicated reorder
// endpoint replaces the `rioku.admin/middleware-ids` label and triggers
// a Caddy reload exactly once.
func TestRouteMiddlewareOrder_PutSetsLabel(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterServicesRoutes(mux, drv)
	RegisterRoutesRoutes(mux, drv)
	RegisterRouteMiddlewareOrderRoutes(mux, drv)

	// Capture reload reasons in-test.
	var reloadReasons []string
	prev := SetCaddyReloadHook(func(_ context.Context, reason string) error {
		reloadReasons = append(reloadReasons, reason)
		return nil
	})
	t.Cleanup(func() { SetCaddyReloadHook(prev) })

	// Seed service.
	svcReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services", "default",
		map[string]any{
			"name":     "svc-mw",
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

	// Create route.
	createReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/routes", "default",
		map[string]any{
			"name":      "rt-mw",
			"enabled":   true,
			"serviceId": svcID,
			"matchers": []map[string]any{
				{"hosts": []string{"example.com"}},
			},
		})
	createRec := httptest.NewRecorder()
	mux.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create route: %d %s", createRec.Code, createRec.Body.String())
	}
	var rt map[string]any
	_ = json.NewDecoder(createRec.Body).Decode(&rt)
	rtID := rt["id"].(string)

	// PUT order.
	order := []string{"mw-a", "mw-b", "mw-c"}
	req := authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/routes/"+rtID+"/middlewares/order", "default",
		map[string]any{"order": order})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("reorder: %d %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	gotOrder, _ := resp["order"].([]any)
	if len(gotOrder) != 3 {
		t.Fatalf("expected 3 ids, got %v", gotOrder)
	}
	for i, want := range order {
		if got := gotOrder[i].(string); got != want {
			t.Errorf("order[%d] = %q, want %q", i, got, want)
		}
	}

	// Verify the label was persisted by re-fetching the route.
	getReq := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/routes/"+rtID, "default", nil)
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get route: %d", getRec.Code)
	}
	var got map[string]any
	_ = json.NewDecoder(getRec.Body).Decode(&got)
	labels, _ := got["labels"].(map[string]any)
	if labels == nil {
		t.Fatalf("expected labels on route, got %v", got)
	}
	inner, _ := labels["labels"].(map[string]any)
	if inner == nil {
		t.Fatalf("expected labels.labels, got %v", labels)
	}
	mwLabel, _ := inner[LabelMiddlewareIDs].(string)
	if mwLabel != strings.Join(order, ",") {
		t.Errorf("label = %q, want %q", mwLabel, strings.Join(order, ","))
	}

	// Caddy reload fired exactly once for this PUT (note: create route
	// itself does not currently trigger reload — only mutating handlers
	// per Item 005 do).
	gotReorder := 0
	for _, reason := range reloadReasons {
		if reason == "route.middlewares.reorder" {
			gotReorder++
		}
	}
	if gotReorder != 1 {
		t.Errorf("expected 1 'route.middlewares.reorder' reload, got %d (all=%v)",
			gotReorder, reloadReasons)
	}
}

// TestRouteMiddlewareOrder_RejectsDuplicates ensures the endpoint refuses
// duplicate middleware ids in the same payload (would silently collide on
// label split).
func TestRouteMiddlewareOrder_RejectsDuplicates(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterServicesRoutes(mux, drv)
	RegisterRoutesRoutes(mux, drv)
	RegisterRouteMiddlewareOrderRoutes(mux, drv)

	// Seed service + route.
	svcReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/services", "default",
		map[string]any{
			"name":     "svc-dup",
			"lbPolicy": "LB_POLICY_ROUND_ROBIN",
			"upstreams": []map[string]any{
				{"address": "127.0.0.1:8000"},
			},
		})
	svcRec := httptest.NewRecorder()
	mux.ServeHTTP(svcRec, svcReq)
	var svc map[string]any
	_ = json.NewDecoder(svcRec.Body).Decode(&svc)
	svcID := svc["id"].(string)
	createReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/routes", "default",
		map[string]any{
			"name":      "rt-dup",
			"enabled":   true,
			"serviceId": svcID,
			"matchers":  []map[string]any{{"hosts": []string{"x"}}},
		})
	createRec := httptest.NewRecorder()
	mux.ServeHTTP(createRec, createReq)
	var rt map[string]any
	_ = json.NewDecoder(createRec.Body).Decode(&rt)
	rtID := rt["id"].(string)

	req := authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/routes/"+rtID+"/middlewares/order", "default",
		map[string]any{"order": []string{"mw-a", "mw-a"}})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on duplicate, got %d %s", rec.Code, rec.Body.String())
	}
}

// TestRouteMiddlewareOrder_404OnMissingRoute checks the not-found case.
func TestRouteMiddlewareOrder_404OnMissingRoute(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterRouteMiddlewareOrderRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/routes/does-not-exist/middlewares/order", "default",
		map[string]any{"order": []string{"mw-a"}})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing route, got %d %s", rec.Code, rec.Body.String())
	}
}
