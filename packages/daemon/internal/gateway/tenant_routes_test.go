package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

// authedTenantRequest is like authedRequest but also attaches the supplied
// tenant to the context (mirroring what TenantMiddleware would do).
func authedTenantRequest(t *testing.T, st store.Driver, method, target, slug string, body any) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, target, &buf)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	claims := &auth.SessionClaims{
		SessionID: "test-session",
		UserID:    "test-user",
		Username:  "tester",
		Roles:     []string{"superadmin"},
		Scopes:    []string{"*"},
	}
	ctx := auth.WithSessionClaims(req.Context(), claims)
	if slug != "" {
		tx, _ := st.Begin(context.Background(), store.TxOptions{ReadOnly: true})
		tn, err := tx.GetTenantBySlug(context.Background(), slug)
		_ = tx.Rollback()
		if err != nil {
			t.Fatalf("resolve tenant %s: %v", slug, err)
		}
		ctx = WithTenant(ctx, tn)
	}
	return req.WithContext(ctx)
}

// ─── Admin tenant CRUD ──────────────────────────────────────────────────────

func TestTenantRoutes_ListIncludesDefault(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/admin/tenants", "", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	items := body["items"].([]any)
	if len(items) < 1 {
		t.Errorf("expected at least 1 tenant, got %d", len(items))
	}
}

func TestTenantRoutes_CreateGetUpdateDelete(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	// Create
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/admin/tenants", "",
		map[string]string{"slug": "acme", "name": "Acme Corp"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	var created tenantResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)
	if created.ID == "" || created.Slug != "acme" {
		t.Errorf("create payload: %+v", created)
	}

	// Get
	req2 := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/admin/tenants/"+created.ID, "", nil)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Errorf("get: expected 200, got %d", rec2.Code)
	}

	// Update
	newName := "Acme Inc."
	req3 := authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/admin/tenants/"+created.ID, "",
		map[string]any{"name": newName})
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("update: expected 200, got %d", rec3.Code)
	}
	var updated tenantResponse
	_ = json.NewDecoder(rec3.Body).Decode(&updated)
	if updated.Name != newName {
		t.Errorf("updated name = %q", updated.Name)
	}

	// Delete
	req4 := authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/admin/tenants/"+created.ID, "", nil)
	rec4 := httptest.NewRecorder()
	mux.ServeHTTP(rec4, req4)
	if rec4.Code != http.StatusNoContent {
		t.Errorf("delete: expected 204, got %d", rec4.Code)
	}
}

func TestTenantRoutes_CreateConflict(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	body := map[string]string{"slug": "default", "name": "Duplicate"}
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/admin/tenants", "", body)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409 on slug conflict, got %d", rec.Code)
	}
}

func TestTenantRoutes_DefaultDeleteForbidden(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/admin/tenants/tenant_default", "", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 deleting default tenant, got %d", rec.Code)
	}
}

func TestTenantRoutes_GetUnknown404(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/admin/tenants/tenant_bogus", "", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

// ─── Tenant-scoped current tenant ───────────────────────────────────────────

func TestTenantRoutes_GetCurrent(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	req := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/settings/tenant", "default", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var body tenantResponse
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body.Slug != "default" {
		t.Errorf("slug = %q, want default", body.Slug)
	}
}

func TestTenantRoutes_UpdateCurrent(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	newName := "Default Renamed"
	req := authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/settings/tenant", "default",
		map[string]any{"name": newName})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body tenantResponse
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body.Name != newName {
		t.Errorf("name = %q", body.Name)
	}
}

// ─── Memberships ────────────────────────────────────────────────────────────

func seedUserForMemberships(t *testing.T, drv store.Driver, username string) string {
	t.Helper()
	ctx := context.Background()
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	user, err := tx.CreateUser(ctx, &store.User{
		Username: username, PasswordHash: "x", Status: "active",
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return user.ID
}

func TestMembershipRoutes_CreateListGet(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	userID := seedUserForMemberships(t, drv, "membership-test-user")

	// Create
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/memberships", "default",
		map[string]string{"userId": userID})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	var created membershipResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)
	if created.UserID != userID || created.State != "pending" {
		t.Errorf("create payload: %+v", created)
	}

	// List should include the new membership.
	req2 := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/memberships", "default", nil)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", rec2.Code)
	}
	var listResp map[string]any
	_ = json.NewDecoder(rec2.Body).Decode(&listResp)
	items := listResp["items"].([]any)
	if len(items) < 1 {
		t.Errorf("expected at least 1 membership, got %d", len(items))
	}

	// Get
	req3 := authedTenantRequest(t, drv, http.MethodGet, "/api/v1/t/default/memberships/"+created.ID, "default", nil)
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Errorf("get: expected 200, got %d", rec3.Code)
	}
}

func TestMembershipRoutes_StateTransitions(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	userID := seedUserForMemberships(t, drv, "state-user")

	// Seed pending membership.
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/memberships", "default",
		map[string]string{"userId": userID})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var created membershipResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)

	// pending -> active
	req2 := authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/memberships/"+created.ID, "default",
		map[string]string{"state": "active"})
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Errorf("pending->active: expected 200, got %d", rec2.Code)
	}

	// Invalid transition: active -> pending
	req3 := authedTenantRequest(t, drv, http.MethodPatch, "/api/v1/t/default/memberships/"+created.ID, "default",
		map[string]string{"state": "pending"})
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusConflict {
		t.Errorf("invalid transition: expected 409, got %d", rec3.Code)
	}
}

func TestMembershipRoutes_SetRoles(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	userID := seedUserForMemberships(t, drv, "roles-user")
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/memberships", "default",
		map[string]string{"userId": userID, "state": "active"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var created membershipResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)

	// Set [viewer, operator]
	req2 := authedTenantRequest(t, drv, http.MethodPut, "/api/v1/t/default/memberships/"+created.ID+"/roles", "default",
		map[string]any{"roleIds": []string{"role_viewer", "role_operator"}})
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("set roles: expected 200, got %d (%s)", rec2.Code, rec2.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(rec2.Body).Decode(&resp)
	roleIDs := resp["roleIds"].([]any)
	if len(roleIDs) != 2 {
		t.Errorf("expected 2 roles, got %d", len(roleIDs))
	}

	// Set [viewer] alone — operator should be revoked.
	req3 := authedTenantRequest(t, drv, http.MethodPut, "/api/v1/t/default/memberships/"+created.ID+"/roles", "default",
		map[string]any{"roleIds": []string{"role_viewer"}})
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("revise roles: expected 200, got %d", rec3.Code)
	}
	_ = json.NewDecoder(rec3.Body).Decode(&resp)
	roleIDs = resp["roleIds"].([]any)
	if len(roleIDs) != 1 || roleIDs[0] != "role_viewer" {
		t.Errorf("expected [role_viewer], got %v", roleIDs)
	}
}

func TestMembershipRoutes_CrossTenantGuard(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	// Create a second tenant.
	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	other, _ := tx.CreateTenant(ctx, &store.Tenant{Slug: "other", Name: "Other"})
	_ = tx.Commit()

	// Create a membership in 'other'.
	userID := seedUserForMemberships(t, drv, "guard-user")
	tx2, _ := drv.Begin(ctx, store.TxOptions{})
	otherMembership, _ := tx2.CreateMembership(ctx, &store.Membership{
		TenantID: other.ID, UserID: userID, State: "active",
	})
	_ = tx2.Commit()

	// Try to get it via the default-tenant route — should 404.
	req := authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/memberships/"+otherMembership.ID, "default", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("cross-tenant get: expected 404, got %d", rec.Code)
	}
}

func TestMembershipRoutes_DeleteMembership(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterTenantRoutes(mux, drv)

	userID := seedUserForMemberships(t, drv, "delete-user")
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/memberships", "default",
		map[string]string{"userId": userID})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var created membershipResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)

	req2 := authedTenantRequest(t, drv, http.MethodDelete, "/api/v1/t/default/memberships/"+created.ID, "default", nil)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusNoContent {
		t.Errorf("delete: expected 204, got %d", rec2.Code)
	}
}
