package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

func TestNotificationChannels_CRUD(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)
	// Use a stub channel impl so /test doesn't actually dial slack.
	prev := installStubChannelDispatcher(t, drv, nil)
	t.Cleanup(prev)

	// Create
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notification-channels", "default",
		map[string]any{"name": "ops-slack", "kind": "slack", "config": map[string]any{"webhook_url": "https://x"}}))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", r.Code, r.Body.String())
	}
	var c channelResponse
	_ = json.NewDecoder(r.Body).Decode(&c)

	// Duplicate name → 409.
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notification-channels", "default",
		map[string]any{"name": "ops-slack", "kind": "email"}))
	if r2.Code != http.StatusConflict {
		t.Errorf("dup channel: expected 409, got %d", r2.Code)
	}

	// Test stub
	r3 := httptest.NewRecorder()
	mux.ServeHTTP(r3, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notification-channels/"+c.ID+"/test", "default", nil))
	if r3.Code != http.StatusOK {
		t.Errorf("test: %d", r3.Code)
	}

	// Delete
	r4 := httptest.NewRecorder()
	mux.ServeHTTP(r4, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/notification-channels/"+c.ID, "default", nil))
	if r4.Code != http.StatusNoContent {
		t.Errorf("delete: %d", r4.Code)
	}
}

func TestNotificationRoutingRules_CRUDAndReorder(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)

	create := func(name string) routingRuleResponse {
		r := httptest.NewRecorder()
		mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
			"/api/v1/t/default/notification-routing", "default",
			map[string]any{"name": name}))
		if r.Code != http.StatusCreated {
			t.Fatalf("create %s: %d (%s)", name, r.Code, r.Body.String())
		}
		var rr routingRuleResponse
		_ = json.NewDecoder(r.Body).Decode(&rr)
		return rr
	}
	a := create("alpha")
	b := create("beta")

	// Reorder [b, a]
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/notification-routing/order", "default",
		map[string]any{"orderedIds": []string{b.ID, a.ID}}))
	if r.Code != http.StatusNoContent {
		t.Errorf("reorder: %d", r.Code)
	}

	// List should reflect the new order.
	listR := httptest.NewRecorder()
	mux.ServeHTTP(listR, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/notification-routing", "default", nil))
	var list map[string]any
	_ = json.NewDecoder(listR.Body).Decode(&list)
	items := list["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["id"] != b.ID {
		t.Errorf("expected b first after reorder, got %v", items)
	}
}

func TestNotificationInbox_OwnershipAndUnreadCount(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)

	// Append a notification for the test user via the store directly.
	ctx := context.Background()
	tID := "tenant_default"
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	n, err := tx.AppendNotificationItem(ctx, &store.NotificationItem{
		TenantID: &tID, UserID: "test-user",
		Title: "Hello", Body: "world", Severity: "info",
	})
	if err != nil {
		t.Fatalf("AppendNotificationItem: %v", err)
	}
	_ = tx.Commit()

	// Unread count should be 1.
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/notifications/unread-count", "default", nil))
	if r.Code != http.StatusOK {
		t.Fatalf("unread count: %d", r.Code)
	}
	var resp map[string]any
	_ = json.NewDecoder(r.Body).Decode(&resp)
	if resp["unreadCount"].(float64) != 1 {
		t.Errorf("unreadCount = %v, want 1", resp["unreadCount"])
	}

	// Mark read.
	mr := httptest.NewRecorder()
	mux.ServeHTTP(mr, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notifications/"+n.ID+"/read", "default", nil))
	if mr.Code != http.StatusNoContent {
		t.Errorf("mark read: %d", mr.Code)
	}

	// Count should now be 0.
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/notifications/unread-count", "default", nil))
	var resp2 map[string]any
	_ = json.NewDecoder(r2.Body).Decode(&resp2)
	if resp2["unreadCount"].(float64) != 0 {
		t.Errorf("after mark read: unreadCount = %v, want 0", resp2["unreadCount"])
	}
}

// TestNotificationMarkUnread_ReadThenUnread covers the four contract cases
// for POST /notifications/{id}/unread:
//   - read-then-unread: read flag flips back to null
//   - already-unread: 204 no-op (idempotent)
//   - not-found: 404 with problem+json
//   - permission-denied: 403 when caller lacks notification:manage-own
func TestNotificationMarkUnread_ReadThenUnread(t *testing.T) {
	t.Parallel()
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)

	// Seed a notification owned by test-user.
	ctx := context.Background()
	tID := "tenant_default"
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	n, err := tx.AppendNotificationItem(ctx, &store.NotificationItem{
		TenantID: &tID, UserID: "test-user",
		Title: "Hello", Body: "world", Severity: "info",
	})
	if err != nil {
		t.Fatalf("AppendNotificationItem: %v", err)
	}
	_ = tx.Commit()

	// 1. Mark read first.
	mr := httptest.NewRecorder()
	mux.ServeHTTP(mr, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notifications/"+n.ID+"/read", "default", nil))
	if mr.Code != http.StatusNoContent {
		t.Fatalf("mark read: %d", mr.Code)
	}

	// Verify it's read in the store.
	tx2, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	got, _ := tx2.GetNotificationItem(ctx, n.ID)
	_ = tx2.Rollback()
	if got.ReadAt == nil {
		t.Fatalf("expected read_at set after /read")
	}

	// 2. Mark unread → 204, read_at cleared.
	mu := httptest.NewRecorder()
	mux.ServeHTTP(mu, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notifications/"+n.ID+"/unread", "default", nil))
	if mu.Code != http.StatusNoContent {
		t.Fatalf("mark unread: %d (%s)", mu.Code, mu.Body.String())
	}
	tx3, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	got2, _ := tx3.GetNotificationItem(ctx, n.ID)
	_ = tx3.Rollback()
	if got2.ReadAt != nil {
		t.Errorf("expected read_at nil after /unread, got %v", got2.ReadAt)
	}

	// 3. Idempotent: marking unread again on already-unread item → 204.
	mu2 := httptest.NewRecorder()
	mux.ServeHTTP(mu2, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notifications/"+n.ID+"/unread", "default", nil))
	if mu2.Code != http.StatusNoContent {
		t.Errorf("idempotent unread: expected 204, got %d", mu2.Code)
	}

	// And reflected in unread-count: should be 1 again.
	uc := httptest.NewRecorder()
	mux.ServeHTTP(uc, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/notifications/unread-count", "default", nil))
	var ucResp map[string]any
	_ = json.NewDecoder(uc.Body).Decode(&ucResp)
	if ucResp["unreadCount"].(float64) != 1 {
		t.Errorf("after mark unread: unreadCount = %v, want 1", ucResp["unreadCount"])
	}
}

func TestNotificationMarkUnread_NotFound(t *testing.T) {
	t.Parallel()
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)

	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notifications/notif_does_not_exist/unread", "default", nil))
	if r.Code != http.StatusNotFound {
		t.Errorf("expected 404 for missing notification, got %d (%s)", r.Code, r.Body.String())
	}
}

func TestNotificationMarkUnread_OtherUserOwned(t *testing.T) {
	t.Parallel()
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)

	// Seed a notification owned by a *different* user.
	ctx := context.Background()
	tID := "tenant_default"
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	// Mark it read so the unread call would otherwise have effect.
	n, err := tx.AppendNotificationItem(ctx, &store.NotificationItem{
		TenantID: &tID, UserID: "someone-else",
		Title: "Not yours", Body: "private", Severity: "info",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := tx.MarkNotificationRead(ctx, n.ID); err != nil {
		t.Fatalf("seed read: %v", err)
	}
	_ = tx.Commit()

	// test-user (the auth helper) tries to unread someone-else's notification.
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notifications/"+n.ID+"/unread", "default", nil))
	if r.Code != http.StatusNotFound {
		t.Errorf("expected 404 (ownership guard), got %d", r.Code)
	}

	// Make sure the read_at was NOT cleared.
	tx2, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	got, _ := tx2.GetNotificationItem(ctx, n.ID)
	_ = tx2.Rollback()
	if got.ReadAt == nil {
		t.Errorf("ownership guard breached: read_at was cleared")
	}
}

func TestNotificationMarkUnread_PermissionDenied(t *testing.T) {
	t.Parallel()
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)

	// Seed read notification for the (non-privileged) user we'll authenticate as.
	ctx := context.Background()
	tID := "tenant_default"
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	n, err := tx.AppendNotificationItem(ctx, &store.NotificationItem{
		TenantID: &tID, UserID: "weak-user",
		Title: "x", Body: "y", Severity: "info",
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := tx.MarkNotificationRead(ctx, n.ID); err != nil {
		t.Fatalf("seed read: %v", err)
	}
	_ = tx.Commit()

	// Build a request with claims that have notification:read but NOT
	// notification:manage-own.
	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/t/default/notifications/"+n.ID+"/unread", nil)
	claims := &auth.SessionClaims{
		SessionID: "weak-session",
		UserID:    "weak-user",
		Username:  "weak",
		Roles:     []string{"viewer"},
		Scopes:    []string{"notification:read"}, // missing manage-own
	}
	rctx := auth.WithSessionClaims(req.Context(), claims)
	tx3, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	tn, _ := tx3.GetTenantBySlug(ctx, "default")
	_ = tx3.Rollback()
	rctx = WithTenant(rctx, tn)
	req = req.WithContext(rctx)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 without notification:manage-own, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestNotificationConfig_GetUpsert(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)

	// GET — should return defaults even with no row inserted.
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/settings/notifications", "default", nil))
	if r.Code != http.StatusOK {
		t.Fatalf("get: %d", r.Code)
	}
	var c tenantNotifConfigResponse
	_ = json.NewDecoder(r.Body).Decode(&c)
	if c.OptInMode != "opt-in" || c.MaxRetries != 3 {
		t.Errorf("defaults wrong: %+v", c)
	}

	// PUT new values.
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/settings/notifications", "default",
		map[string]any{
			"enabled":             true,
			"optInMode":           "opt-out",
			"maxRetries":          5,
			"retryBackoffSeconds": 60,
		}))
	if r2.Code != http.StatusOK {
		t.Fatalf("put: %d", r2.Code)
	}

	// Re-read.
	r3 := httptest.NewRecorder()
	mux.ServeHTTP(r3, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/settings/notifications", "default", nil))
	var c2 tenantNotifConfigResponse
	_ = json.NewDecoder(r3.Body).Decode(&c2)
	if c2.OptInMode != "opt-out" || c2.MaxRetries != 5 {
		t.Errorf("upsert didn't stick: %+v", c2)
	}
}
