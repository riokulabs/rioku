package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestSettingsPKI_RevocationsListEmpty confirms the GET endpoint
// returns an empty list (with the documented `items` envelope) when no
// revoked enrollments exist for the tenant.
func TestSettingsPKI_RevocationsListEmpty(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsPKIRoutes(mux, drv)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/settings/pki/revocations", "default", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp revocationListResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Items == nil {
		t.Error("Items must be a non-nil slice (empty list)")
	}
	if len(resp.Items) != 0 {
		t.Errorf("len = %d, want 0", len(resp.Items))
	}
}

// TestSettingsPKI_RevocationCreateAndList exercises the full happy
// path: POST a synthetic revocation (serial we made up), then GET the
// list and assert the new entry shows up.
func TestSettingsPKI_RevocationCreateAndList(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsPKIRoutes(mux, drv)

	// Create
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/pki/revocations", "default",
		map[string]any{"serial": "rev-001", "reason": "compromised", "subject": "CN=test.example.com"}))
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("create: status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var created revocationItem
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if created.Serial != "rev-001" || created.Reason != "compromised" {
		t.Errorf("created = %+v", created)
	}
	if created.RevokedAt == "" {
		t.Error("RevokedAt should be populated")
	}

	// List
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/settings/pki/revocations", "default", nil))
	if rec2.Code != http.StatusOK {
		t.Fatalf("list: status = %d", rec2.Code)
	}
	var list revocationListResponse
	_ = json.NewDecoder(rec2.Body).Decode(&list)
	if len(list.Items) != 1 || list.Items[0].Serial != "rev-001" {
		t.Errorf("list = %+v", list.Items)
	}
}

// TestSettingsPKI_RevocationCreateValidation rejects payloads missing
// serial or reason.
func TestSettingsPKI_RevocationCreateValidation(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsPKIRoutes(mux, drv)

	cases := []map[string]any{
		{"reason": "lost"},
		{"serial": "x"},
		{"serial": "", "reason": ""},
	}
	for i, body := range cases {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
			"/api/v1/t/default/settings/pki/revocations", "default", body))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("case %d (%v): status = %d, want 400", i, body, rec.Code)
		}
	}
}
