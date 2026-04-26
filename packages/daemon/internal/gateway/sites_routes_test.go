package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSites_CreateListGetUpdateDelete(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSiteRoutes(mux, drv)

	// Create
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/sites", "default",
		map[string]any{"name": "API", "domain": "api.example.com"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	var created siteResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)
	if !created.Enabled || created.Domain != "api.example.com" || created.TLSMode != "auto" {
		t.Errorf("create payload: %+v", created)
	}

	// List
	req2 := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/sites", "default", nil)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("list: %d", rec2.Code)
	}
	var listResp map[string]any
	_ = json.NewDecoder(rec2.Body).Decode(&listResp)
	if listResp["total"].(float64) != 1 {
		t.Errorf("expected 1 site, got %v", listResp["total"])
	}

	// Get
	req3 := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/sites/"+created.ID, "default", nil)
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Errorf("get: %d", rec3.Code)
	}

	// Update
	newName := "API v2"
	req4 := authedTenantRequest(t, drv, http.MethodPut, "/api/v1/t/default/sites/"+created.ID, "default",
		map[string]any{"name": newName})
	rec4 := httptest.NewRecorder()
	mux.ServeHTTP(rec4, req4)
	if rec4.Code != http.StatusOK {
		t.Fatalf("update: %d", rec4.Code)
	}
	var updated siteResponse
	_ = json.NewDecoder(rec4.Body).Decode(&updated)
	if updated.Name != newName {
		t.Errorf("name = %q", updated.Name)
	}

	// Delete
	req5 := authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/sites/"+created.ID, "default", nil)
	rec5 := httptest.NewRecorder()
	mux.ServeHTTP(rec5, req5)
	if rec5.Code != http.StatusNoContent {
		t.Errorf("delete: %d", rec5.Code)
	}
}

func TestSites_DomainConflict(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSiteRoutes(mux, drv)

	body := map[string]any{"name": "A", "domain": "dup.example.com"}
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/sites", "default", body)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("first create: %d", rec.Code)
	}

	// Same domain, different name — should 409.
	body2 := map[string]any{"name": "B", "domain": "dup.example.com"}
	req2 := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/sites", "default", body2)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusConflict {
		t.Errorf("expected 409 on domain conflict, got %d", rec2.Code)
	}
}

func TestSites_Toggle(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSiteRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/sites", "default",
		map[string]any{"name": "Toggle", "domain": "toggle.example.com"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var created siteResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)

	req2 := authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/sites/"+created.ID+"/enabled", "default",
		map[string]any{"enabled": false})
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("toggle: %d", rec2.Code)
	}
	var disabled siteResponse
	_ = json.NewDecoder(rec2.Body).Decode(&disabled)
	if disabled.Enabled {
		t.Errorf("expected enabled=false after toggle, got %+v", disabled)
	}
}

func TestSites_NotFound(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSiteRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/sites/nope", "default", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}
