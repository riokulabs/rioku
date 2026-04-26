package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// createTestDashboard helper.
func createTestDashboard(t *testing.T, mux *http.ServeMux, st any, name string) dashboardResponse {
	t.Helper()
	drv := st.(interface{ Begin(any, any) any })
	_ = drv
	return dashboardResponse{}
}

func TestDashboards_CreateListGetUpdateDelete(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterDashboardRoutes(mux, drv)

	// Create
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards", "default",
		map[string]any{"name": "Overview", "scope": "tenant"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	var created dashboardResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)
	if created.Name != "Overview" || created.Scope != "tenant" || created.Mode != "metabase" {
		t.Errorf("create payload: %+v", created)
	}

	// List
	req2 := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/dashboards", "default", nil)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("list: %d", rec2.Code)
	}
	var list map[string]any
	_ = json.NewDecoder(rec2.Body).Decode(&list)
	if list["total"].(float64) != 1 {
		t.Errorf("expected 1, got %v", list["total"])
	}

	// Update
	newName := "Renamed"
	req3 := authedTenantRequest(t, drv, http.MethodPut, "/api/v1/t/default/dashboards/"+created.ID, "default",
		map[string]any{"name": newName})
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("update: %d", rec3.Code)
	}
	var updated dashboardResponse
	_ = json.NewDecoder(rec3.Body).Decode(&updated)
	if updated.Name != newName {
		t.Errorf("name = %q", updated.Name)
	}

	// Delete
	req4 := authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/dashboards/"+created.ID, "default", nil)
	rec4 := httptest.NewRecorder()
	mux.ServeHTTP(rec4, req4)
	if rec4.Code != http.StatusNoContent {
		t.Errorf("delete: %d", rec4.Code)
	}
}

func TestDashboards_SetDefault_ClearsOthers(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterDashboardRoutes(mux, drv)

	create := func(name string) dashboardResponse {
		req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards", "default",
			map[string]any{"name": name})
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		var d dashboardResponse
		_ = json.NewDecoder(rec.Body).Decode(&d)
		return d
	}
	a := create("A")
	b := create("B")

	// Set A as default.
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards/"+a.ID+"/set-default", "default", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("set-default A: %d", rec.Code)
	}
	var updated dashboardResponse
	_ = json.NewDecoder(rec.Body).Decode(&updated)
	if !updated.IsDefault {
		t.Errorf("A should be default, got %+v", updated)
	}

	// Set B as default — A should now be cleared.
	req2 := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards/"+b.ID+"/set-default", "default", nil)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("set-default B: %d", rec2.Code)
	}

	// Read A back and confirm IsDefault is false.
	req3 := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/dashboards/"+a.ID, "default", nil)
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)
	var aAfter dashboardResponse
	_ = json.NewDecoder(rec3.Body).Decode(&aAfter)
	if aAfter.IsDefault {
		t.Errorf("A should no longer be default after B was set, got %+v", aAfter)
	}
}

func TestWidgets_LifecycleAndOwnership(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterDashboardRoutes(mux, drv)

	// Create dashboard.
	dReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards", "default",
		map[string]any{"name": "DashWithWidgets"})
	dRec := httptest.NewRecorder()
	mux.ServeHTTP(dRec, dReq)
	var d dashboardResponse
	_ = json.NewDecoder(dRec.Body).Decode(&d)

	// Add widget.
	wReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards/"+d.ID+"/widgets", "default",
		map[string]any{"kind": "single-stat", "title": "Total Requests"})
	wRec := httptest.NewRecorder()
	mux.ServeHTTP(wRec, wReq)
	if wRec.Code != http.StatusCreated {
		t.Fatalf("add widget: %d (%s)", wRec.Code, wRec.Body.String())
	}
	var widget widgetResponse
	_ = json.NewDecoder(wRec.Body).Decode(&widget)
	if widget.Kind != "single-stat" {
		t.Errorf("widget kind: %v", widget.Kind)
	}

	// List widgets.
	listReq := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/dashboards/"+d.ID+"/widgets", "default", nil)
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Errorf("list widgets: %d", listRec.Code)
	}

	// Flip to advanced.
	flipReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/widgets/"+widget.ID+"/flip-advanced", "default", nil)
	flipRec := httptest.NewRecorder()
	mux.ServeHTTP(flipRec, flipReq)
	if flipRec.Code != http.StatusOK {
		t.Errorf("flip-advanced: %d", flipRec.Code)
	}
	var flipped widgetResponse
	_ = json.NewDecoder(flipRec.Body).Decode(&flipped)
	if !flipped.LockedAdvanced {
		t.Errorf("expected lockedAdvanced=true, got %+v", flipped)
	}

	// Delete via dashboard-scoped route.
	delReq := authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/dashboards/"+d.ID+"/widgets/"+widget.ID, "default", nil)
	delRec := httptest.NewRecorder()
	mux.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusNoContent {
		t.Errorf("delete widget: %d", delRec.Code)
	}
}

func TestDashboards_SnapshotAndRestore(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterDashboardRoutes(mux, drv)

	dReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards", "default",
		map[string]any{"name": "Snap"})
	dRec := httptest.NewRecorder()
	mux.ServeHTTP(dRec, dReq)
	var d dashboardResponse
	_ = json.NewDecoder(dRec.Body).Decode(&d)

	// Add a widget.
	wReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards/"+d.ID+"/widgets", "default",
		map[string]any{"kind": "table", "title": "Original"})
	wRec := httptest.NewRecorder()
	mux.ServeHTTP(wRec, wReq)

	// Snapshot v1.
	snapReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards/"+d.ID+"/snapshot", "default",
		map[string]any{"note": "before edits"})
	snapRec := httptest.NewRecorder()
	mux.ServeHTTP(snapRec, snapReq)
	if snapRec.Code != http.StatusCreated {
		t.Fatalf("snapshot: %d (%s)", snapRec.Code, snapRec.Body.String())
	}
	var v1 versionResponse
	_ = json.NewDecoder(snapRec.Body).Decode(&v1)
	if v1.Version != 1 {
		t.Errorf("expected version=1, got %d", v1.Version)
	}

	// Modify — rename dashboard, add another widget.
	renameReq := authedTenantRequest(t, drv, http.MethodPut, "/api/v1/t/default/dashboards/"+d.ID, "default",
		map[string]any{"name": "ModifiedName"})
	mux.ServeHTTP(httptest.NewRecorder(), renameReq)
	addReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards/"+d.ID+"/widgets", "default",
		map[string]any{"kind": "single-stat", "title": "New"})
	mux.ServeHTTP(httptest.NewRecorder(), addReq)

	// Restore v1.
	restoreReq := authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/dashboards/versions/"+v1.ID+"/restore", "default", nil)
	restoreRec := httptest.NewRecorder()
	mux.ServeHTTP(restoreRec, restoreReq)
	if restoreRec.Code != http.StatusOK {
		t.Fatalf("restore: %d (%s)", restoreRec.Code, restoreRec.Body.String())
	}
	var restored dashboardResponse
	_ = json.NewDecoder(restoreRec.Body).Decode(&restored)
	if restored.Name != "Snap" {
		t.Errorf("restored name = %q, want Snap", restored.Name)
	}

	// Confirm there's exactly 1 widget after restore.
	listReq := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/dashboards/"+d.ID+"/widgets", "default", nil)
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)
	var list map[string]any
	_ = json.NewDecoder(listRec.Body).Decode(&list)
	items := list["items"].([]any)
	if len(items) != 1 {
		t.Errorf("expected 1 widget after restore, got %d", len(items))
	}
}

func TestDashboards_ExportAndImport(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterDashboardRoutes(mux, drv)

	// Create source dashboard with widget.
	dReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards", "default",
		map[string]any{"name": "Source"})
	dRec := httptest.NewRecorder()
	mux.ServeHTTP(dRec, dReq)
	var d dashboardResponse
	_ = json.NewDecoder(dRec.Body).Decode(&d)
	wReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards/"+d.ID+"/widgets", "default",
		map[string]any{"kind": "pie", "title": "Distribution"})
	mux.ServeHTTP(httptest.NewRecorder(), wReq)

	// Export.
	expReq := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/dashboards/"+d.ID+"/export", "default", nil)
	expRec := httptest.NewRecorder()
	mux.ServeHTTP(expRec, expReq)
	if expRec.Code != http.StatusOK {
		t.Fatalf("export: %d", expRec.Code)
	}
	var payload exportPayload
	_ = json.NewDecoder(expRec.Body).Decode(&payload)
	if len(payload.Widgets) != 1 {
		t.Errorf("expected 1 widget in export, got %d", len(payload.Widgets))
	}

	// Import a copy.
	payload.Dashboard.Name = "Imported Copy"
	impReq := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/dashboards/import", "default", payload)
	impRec := httptest.NewRecorder()
	mux.ServeHTTP(impRec, impReq)
	if impRec.Code != http.StatusCreated {
		t.Fatalf("import: %d (%s)", impRec.Code, impRec.Body.String())
	}
	var imported dashboardResponse
	_ = json.NewDecoder(impRec.Body).Decode(&imported)
	if imported.Name != "Imported Copy" || imported.ID == d.ID {
		t.Errorf("imported should be fresh, got %+v", imported)
	}
}

func TestDashboards_NotFound(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterDashboardRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/dashboards/nope", "default", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}
