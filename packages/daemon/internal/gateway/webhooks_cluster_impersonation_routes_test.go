package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWebhooks_CRUDAndConflict(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterWebhooksClusterImpersonationRoutes(mux, drv)

	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/webhooks", "default",
		map[string]any{"name": "deploy-hook", "url": "https://hooks.example/deploy"}))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", r.Code, r.Body.String())
	}

	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/webhooks", "default",
		map[string]any{"name": "deploy-hook", "url": "https://other.example/deploy"}))
	if r2.Code != http.StatusConflict {
		t.Errorf("dup: expected 409, got %d", r2.Code)
	}
}

func TestEnrollmentTokens_LifecycleAndRevoke(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterWebhooksClusterImpersonationRoutes(mux, drv)

	// Create — returns the raw token in the response body.
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/cluster/enrollment-tokens", "default",
		map[string]any{"ttlSeconds": 3600, "notes": "for node-2"}))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", r.Code, r.Body.String())
	}
	var created createEnrollmentTokenResponse
	_ = json.NewDecoder(r.Body).Decode(&created)
	if created.Token == "" {
		t.Error("expected raw token in create response")
	}

	// List should include the new token.
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/cluster/enrollment-tokens", "default", nil))
	var list map[string]any
	_ = json.NewDecoder(r2.Body).Decode(&list)
	items := list["items"].([]any)
	if len(items) != 1 {
		t.Errorf("expected 1 token, got %d", len(items))
	}

	// Revoke
	r3 := httptest.NewRecorder()
	mux.ServeHTTP(r3, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/cluster/enrollment-tokens/"+created.ID, "default", nil))
	if r3.Code != http.StatusNoContent {
		t.Errorf("revoke: %d", r3.Code)
	}

	// List should now be empty (revoked tokens are filtered out by ListActive).
	r4 := httptest.NewRecorder()
	mux.ServeHTTP(r4, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/cluster/enrollment-tokens", "default", nil))
	var list2 map[string]any
	_ = json.NewDecoder(r4.Body).Decode(&list2)
	if list2["total"].(float64) != 0 {
		t.Errorf("expected 0 active tokens after revoke, got %v", list2["total"])
	}
}

func TestImpersonation_StartListEnd(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterWebhooksClusterImpersonationRoutes(mux, drv)

	// Start
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/admin/impersonation", "",
		map[string]any{"reason": "support ticket #42", "ttlSeconds": 1800}))
	if r.Code != http.StatusCreated {
		t.Fatalf("start: %d (%s)", r.Code, r.Body.String())
	}
	var started impersonationResponse
	_ = json.NewDecoder(r.Body).Decode(&started)
	if started.Reason != "support ticket #42" {
		t.Errorf("reason wrong: %+v", started)
	}

	// List active sessions.
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/admin/impersonation", "", nil))
	var list map[string]any
	_ = json.NewDecoder(r2.Body).Decode(&list)
	sessions, _ := list["sessions"].([]any)
	if len(sessions) != 1 {
		t.Errorf("expected 1 active session, got %v", list["sessions"])
	}

	// End
	r3 := httptest.NewRecorder()
	mux.ServeHTTP(r3, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/admin/impersonation/"+started.ID, "", nil))
	if r3.Code != http.StatusOK {
		t.Errorf("end: %d", r3.Code)
	}
	var ended impersonationResponse
	_ = json.NewDecoder(r3.Body).Decode(&ended)
	if ended.EndedAt == nil || ended.EndReason == nil || *ended.EndReason != "explicit_exit" {
		t.Errorf("end didn't stick: %+v", ended)
	}

	// Double-end → 409
	r4 := httptest.NewRecorder()
	mux.ServeHTTP(r4, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/admin/impersonation/"+started.ID, "", nil))
	if r4.Code != http.StatusConflict {
		t.Errorf("double-end: expected 409, got %d", r4.Code)
	}
}
