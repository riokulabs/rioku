package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func setupTestStore(t *testing.T) store.Driver {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	t.Cleanup(func() { drv.Close() })
	return drv
}

func createTestUser(t *testing.T, drv store.Driver, username string) *store.User {
	t.Helper()
	ctx := context.Background()

	hash, err := auth.HashPassword("TestPass1!")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	user, err := tx.CreateUser(ctx, &store.User{
		Username:     username,
		PasswordHash: hash,
		Status:       "active",
	})
	if err != nil {
		tx.Rollback()
		t.Fatalf("CreateUser: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	return user
}

func fakeRequest(userAgent, acceptLanguage string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("User-Agent", userAgent)
	r.Header.Set("Accept-Language", acceptLanguage)
	return r
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestSessionCreate(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "alice")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Session ID should be a valid UUID (36 chars with hyphens).
	if len(sess.ID) != 36 {
		t.Errorf("expected UUID (36 chars), got %q (len %d)", sess.ID, len(sess.ID))
	}

	// Expiry should be ~7 days out.
	diff := time.Until(sess.ExpiresAt)
	if diff < 6*24*time.Hour || diff > 8*24*time.Hour {
		t.Errorf("expected expiry ~7d out, got %v", diff)
	}

	// Fingerprint should be a hex-encoded SHA-256 (64 chars).
	if len(sess.Fingerprint) != 64 {
		t.Errorf("expected fingerprint length 64, got %d", len(sess.Fingerprint))
	}

	expectedFP := auth.ComputeFingerprint("Mozilla/5.0", "en-US")
	if sess.Fingerprint != expectedFP {
		t.Errorf("fingerprint mismatch: got %q, want %q", sess.Fingerprint, expectedFP)
	}
}

func TestSessionValidate(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "bob")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	claims, err := sm.ValidateSession(ctx, sess.ID, req)
	if err != nil {
		t.Fatalf("ValidateSession: %v", err)
	}

	if claims.SessionID != sess.ID {
		t.Errorf("claims.SessionID = %q, want %q", claims.SessionID, sess.ID)
	}
	if claims.UserID != user.ID {
		t.Errorf("claims.UserID = %q, want %q", claims.UserID, user.ID)
	}
	if claims.Username != user.Username {
		t.Errorf("claims.Username = %q, want %q", claims.Username, user.Username)
	}
	if claims.Roles == nil {
		t.Error("claims.Roles should be non-nil (empty slice)")
	}
	if claims.Scopes == nil {
		t.Error("claims.Scopes should be non-nil (empty slice)")
	}
}

func TestSessionValidateCacheMiss(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "carol")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// First validate — cache miss, hits DB.
	claims1, err := sm.ValidateSession(ctx, sess.ID, req)
	if err != nil {
		t.Fatalf("ValidateSession (miss): %v", err)
	}

	// Second validate — cache hit.
	claims2, err := sm.ValidateSession(ctx, sess.ID, req)
	if err != nil {
		t.Fatalf("ValidateSession (hit): %v", err)
	}

	// Both should return equivalent claims.
	if claims1.SessionID != claims2.SessionID {
		t.Errorf("session IDs differ: %q vs %q", claims1.SessionID, claims2.SessionID)
	}
	if claims1.UserID != claims2.UserID {
		t.Errorf("user IDs differ: %q vs %q", claims1.UserID, claims2.UserID)
	}
}

func TestSessionFingerprintMismatch(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "dave")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req1 := fakeRequest("Mozilla/5.0", "en-US")
	sess, err := sm.CreateSession(ctx, user.ID, req1)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Validate with a different User-Agent.
	req2 := fakeRequest("curl/7.68.0", "en-US")
	_, err = sm.ValidateSession(ctx, sess.ID, req2)
	if err == nil {
		t.Fatal("expected fingerprint mismatch error, got nil")
	}
	if !strings.Contains(err.Error(), "fingerprint mismatch") {
		t.Errorf("expected fingerprint mismatch error, got: %v", err)
	}
}

func TestSessionExpired(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "eve")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Manually set expires_at to the past in the DB.
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	pastTime := time.Now().Add(-1 * time.Hour).UTC()
	if err := tx.UpdateSessionLastActive(ctx, sess.ID, pastTime); err != nil {
		tx.Rollback()
		t.Fatalf("UpdateSessionLastActive: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// We need to expire the session. The UpdateSessionLastActive only
	// changes last_active. We need to directly modify expires_at.
	// Use a raw tx to update expires_at to the past.
	tx2, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	// Delete and recreate with expired time.
	if err := tx2.DeleteSession(ctx, sess.ID); err != nil {
		tx2.Rollback()
		t.Fatalf("DeleteSession: %v", err)
	}
	expiredSess := &store.Session{
		ID:          sess.ID,
		UserID:      user.ID,
		Fingerprint: sess.Fingerprint,
		ExpiresAt:   time.Now().Add(-1 * time.Hour).UTC(),
		LastActive:  time.Now().UTC(),
		IPAddress:   sess.IPAddress,
		UserAgent:   sess.UserAgent,
	}
	if _, err := tx2.CreateSession(ctx, expiredSess); err != nil {
		tx2.Rollback()
		t.Fatalf("CreateSession (expired): %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	_, err = sm.ValidateSession(ctx, sess.ID, req)
	if err == nil {
		t.Fatal("expected expired session error, got nil")
	}
	if !strings.Contains(err.Error(), "expired") {
		t.Errorf("expected expired error, got: %v", err)
	}
}

func TestSessionRevoke(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "frank")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sess1, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession 1: %v", err)
	}
	sess2, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession 2: %v", err)
	}

	// Revoke session 1.
	if err := sm.RevokeSession(ctx, sess1.ID); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}

	// Session 1 should be gone.
	_, err = sm.ValidateSession(ctx, sess1.ID, req)
	if err == nil {
		t.Fatal("expected error validating revoked session, got nil")
	}

	// Session 2 should still work.
	_, err = sm.ValidateSession(ctx, sess2.ID, req)
	if err != nil {
		t.Fatalf("expected session 2 to still be valid: %v", err)
	}
}

func TestRevokeAllExcept(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "grace")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sess1, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession 1: %v", err)
	}
	sess2, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession 2: %v", err)
	}

	// Keep sess1, revoke everything else.
	if err := sm.RevokeOtherSessions(ctx, user.ID, sess1.ID); err != nil {
		t.Fatalf("RevokeOtherSessions: %v", err)
	}

	// Session 1 should still work.
	_, err = sm.ValidateSession(ctx, sess1.ID, req)
	if err != nil {
		t.Fatalf("expected session 1 to still be valid: %v", err)
	}

	// Session 2 should be gone.
	_, err = sm.ValidateSession(ctx, sess2.ID, req)
	if err == nil {
		t.Fatal("expected error validating revoked session 2, got nil")
	}
}

func TestLastActiveDebounce(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "heidi")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// First validate — triggers last_active update.
	_, err = sm.ValidateSession(ctx, sess.ID, req)
	if err != nil {
		t.Fatalf("ValidateSession 1: %v", err)
	}

	// Read last_active from DB.
	tx1, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	s1, err := tx1.GetSession(ctx, sess.ID)
	if err != nil {
		tx1.Rollback()
		t.Fatalf("GetSession: %v", err)
	}
	tx1.Rollback()
	lastActive1 := s1.LastActive

	// Second validate within debounce window — should NOT update last_active.
	_, err = sm.ValidateSession(ctx, sess.ID, req)
	if err != nil {
		t.Fatalf("ValidateSession 2: %v", err)
	}

	tx2, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	s2, err := tx2.GetSession(ctx, sess.ID)
	if err != nil {
		tx2.Rollback()
		t.Fatalf("GetSession: %v", err)
	}
	tx2.Rollback()
	lastActive2 := s2.LastActive

	// last_active should not have changed on the second call (debounce).
	if !lastActive1.Equal(lastActive2) {
		t.Errorf("last_active changed within debounce window: %v -> %v", lastActive1, lastActive2)
	}
}

func TestSessionUserSuspended(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "ivan")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Suspend the user.
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	user.Status = "suspended"
	if _, err := tx.UpdateUser(ctx, user); err != nil {
		tx.Rollback()
		t.Fatalf("UpdateUser: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Validate should fail — user is suspended.
	_, err = sm.ValidateSession(ctx, sess.ID, req)
	if err == nil {
		t.Fatal("expected error for suspended user, got nil")
	}
	if !strings.Contains(err.Error(), "suspended") {
		t.Errorf("expected suspended error, got: %v", err)
	}
}

func TestSessionContextHelpers(t *testing.T) {
	claims := &auth.SessionClaims{
		SessionID: "sid-1",
		UserID:    "uid-1",
		Username:  "testuser",
		Roles:     []string{"admin"},
		Scopes:    []string{"config:read", "config:*", "*"},
	}

	ctx := auth.WithSessionClaims(context.Background(), claims)
	got := auth.SessionClaimsFromContext(ctx)
	if got == nil {
		t.Fatal("expected claims from context, got nil")
	}
	if got.SessionID != "sid-1" {
		t.Errorf("SessionID = %q, want %q", got.SessionID, "sid-1")
	}

	// Nil context should return nil.
	got2 := auth.SessionClaimsFromContext(context.Background())
	if got2 != nil {
		t.Errorf("expected nil claims, got %+v", got2)
	}
}

func TestHasPermission(t *testing.T) {
	tests := []struct {
		name   string
		scopes []string
		perm   string
		want   bool
	}{
		{"exact match", []string{"config:read"}, "config:read", true},
		{"no match", []string{"config:read"}, "config:write", false},
		{"wildcard star", []string{"*"}, "anything", true},
		{"prefix wildcard", []string{"config:*"}, "config:read", true},
		{"prefix wildcard write", []string{"config:*"}, "config:write", true},
		{"prefix wildcard no match", []string{"config:*"}, "routes:read", false},
		{"empty scopes", nil, "config:read", false},
		{"multiple scopes", []string{"routes:read", "config:*"}, "config:write", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &auth.SessionClaims{Scopes: tt.scopes}
			if got := c.HasPermission(tt.perm); got != tt.want {
				t.Errorf("HasPermission(%q) = %v, want %v", tt.perm, got, tt.want)
			}
		})
	}
}

func TestCleanupWorker(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "cleanup_user")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")

	// Create a valid session via the normal flow.
	validSess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession (valid): %v", err)
	}

	// Create an expired session: delete and recreate with expires_at in the past.
	tempSess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession (temp): %v", err)
	}
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	if err := tx.DeleteSession(ctx, tempSess.ID); err != nil {
		tx.Rollback()
		t.Fatalf("DeleteSession: %v", err)
	}
	expiredSess := &store.Session{
		ID:          tempSess.ID,
		UserID:      user.ID,
		Fingerprint: tempSess.Fingerprint,
		ExpiresAt:   time.Now().Add(-1 * time.Second).UTC(),
		LastActive:  time.Now().Add(-1 * time.Second).UTC(),
		IPAddress:   tempSess.IPAddress,
		UserAgent:   tempSess.UserAgent,
	}
	if _, err := tx.CreateSession(ctx, expiredSess); err != nil {
		tx.Rollback()
		t.Fatalf("CreateSession (expired): %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Call CleanupExpired directly — should remove exactly 1 expired session.
	n, err := sm.CleanupExpired(ctx)
	if err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}
	if n != 1 {
		t.Errorf("CleanupExpired deleted %d rows, want 1", n)
	}

	// Verify the valid session is still present.
	txRead, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("Begin (read): %v", err)
	}
	got, err := txRead.GetSession(ctx, validSess.ID)
	if err != nil {
		txRead.Rollback()
		t.Fatalf("GetSession (valid): %v", err)
	}
	txRead.Rollback()

	if got.ID != validSess.ID {
		t.Errorf("valid session ID = %q, want %q", got.ID, validSess.ID)
	}
}

func TestComputeFingerprint(t *testing.T) {
	fp1 := auth.ComputeFingerprint("Mozilla/5.0", "en-US")
	fp2 := auth.ComputeFingerprint("Mozilla/5.0", "en-US")
	fp3 := auth.ComputeFingerprint("curl/7.68.0", "en-US")

	if fp1 != fp2 {
		t.Error("same inputs should produce same fingerprint")
	}
	if fp1 == fp3 {
		t.Error("different inputs should produce different fingerprint")
	}
	if len(fp1) != 64 {
		t.Errorf("expected hex SHA-256 length 64, got %d", len(fp1))
	}
}

func TestSetCookieAndClear(t *testing.T) {
	drv := setupTestStore(t)
	sm := auth.NewSessionManager(drv, false) // devMode=false -> Secure=true

	// Test SetCookie.
	w := httptest.NewRecorder()
	sm.SetCookie(w, "test-session-id")

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if c.Name != auth.SessionCookieName {
		t.Errorf("cookie name = %q, want %q", c.Name, auth.SessionCookieName)
	}
	if c.Value != "test-session-id" {
		t.Errorf("cookie value = %q, want %q", c.Value, "test-session-id")
	}
	if !c.HttpOnly {
		t.Error("expected HttpOnly=true")
	}
	if !c.Secure {
		t.Error("expected Secure=true in production mode")
	}
	if c.MaxAge != 86400 {
		t.Errorf("expected MaxAge=86400, got %d", c.MaxAge)
	}

	// Test ClearCookie.
	w2 := httptest.NewRecorder()
	sm.ClearCookie(w2)

	cookies2 := w2.Result().Cookies()
	if len(cookies2) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies2))
	}
	if cookies2[0].MaxAge != -1 {
		t.Errorf("expected MaxAge=-1, got %d", cookies2[0].MaxAge)
	}

	// Test devMode -> Secure=false.
	smDev := auth.NewSessionManager(drv, true)
	w3 := httptest.NewRecorder()
	smDev.SetCookie(w3, "dev-session")
	cookies3 := w3.Result().Cookies()
	if len(cookies3) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies3))
	}
	if cookies3[0].Secure {
		t.Error("expected Secure=false in dev mode")
	}
}
