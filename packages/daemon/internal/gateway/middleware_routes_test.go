package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMiddlewares_CreateListGetUpdateDelete(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterMiddlewareRoutes(mux, drv)

	// Create
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/middlewares", "default",
		map[string]any{
			"name":   "rl-strict",
			"kind":   "rate-limit",
			"config": map[string]any{"requests_per_minute": 100},
		})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	var created middlewareResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)
	if created.Kind != "rate-limit" || created.Name != "rl-strict" {
		t.Errorf("create payload: %+v", created)
	}

	// List
	req2 := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/middlewares", "default", nil)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("list: %d", rec2.Code)
	}

	// Update
	newName := "rl-tightened"
	req3 := authedTenantRequest(t, drv, http.MethodPut, "/api/v1/t/default/middlewares/"+created.ID, "default",
		map[string]any{"name": newName})
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("update: %d", rec3.Code)
	}
	var updated middlewareResponse
	_ = json.NewDecoder(rec3.Body).Decode(&updated)
	if updated.Name != newName {
		t.Errorf("name = %q", updated.Name)
	}

	// Delete
	req4 := authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/middlewares/"+created.ID, "default", nil)
	rec4 := httptest.NewRecorder()
	mux.ServeHTTP(rec4, req4)
	if rec4.Code != http.StatusNoContent {
		t.Errorf("delete: %d", rec4.Code)
	}
}

func TestMiddlewares_NameConflict(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterMiddlewareRoutes(mux, drv)

	body := map[string]any{"name": "dup", "kind": "logging"}
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/middlewares", "default", body)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("first: %d", rec.Code)
	}

	req2 := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/middlewares", "default", body)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rec2.Code)
	}
}

func TestMiddlewares_BadKindRejectedByConstraint(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterMiddlewareRoutes(mux, drv)

	// kind="garbage" violates the CHECK constraint and surfaces as a 500.
	// This documents that the constraint is enforced at the DB layer.
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/middlewares", "default",
		map[string]any{"name": "bad", "kind": "garbage"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code == http.StatusCreated {
		t.Errorf("CHECK constraint should have rejected garbage kind, got 201")
	}
}
