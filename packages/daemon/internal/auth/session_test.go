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
	t.Cleanup(func() { _ = drv.Close() })
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
		_ = tx.Rollback()
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
		_ = tx.Rollback()
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
		_ = tx2.Rollback()
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
		_ = tx2.Rollback()
		t.Fatalf("CreateSession (expired): %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Use a fresh SessionManager so validation must hit the DB (cache miss).
	sm2 := auth.NewSessionManager(drv, true)
	_, err = sm2.ValidateSession(ctx, sess.ID, req)
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
		_ = tx1.Rollback()
		t.Fatalf("GetSession: %v", err)
	}
	_ = tx1.Rollback()
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
		_ = tx2.Rollback()
		t.Fatalf("GetSession: %v", err)
	}
	_ = tx2.Rollback()
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
		_ = tx.Rollback()
		t.Fatalf("UpdateUser: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	// Use a fresh SessionManager to force a cache miss — the suspended
	// status is checked on DB read, not from the cached entry.
	sm2 := auth.NewSessionManager(drv, true)
	_, err = sm2.ValidateSession(ctx, sess.ID, req)
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
		return
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
		_ = tx.Rollback()
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
		_ = tx.Rollback()
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
		_ = txRead.Rollback()
		t.Fatalf("GetSession (valid): %v", err)
	}
	_ = txRead.Rollback()

	if got.ID != validSess.ID {
		t.Errorf("valid session ID = %q, want %q", got.ID, validSess.ID)
	}
}

func TestRevokeAllSessionsForUser(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "revoke_all_user")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")

	// Create 3 sessions for the user.
	sess1, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession 1: %v", err)
	}
	sess2, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession 2: %v", err)
	}
	sess3, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession 3: %v", err)
	}

	// Revoke all sessions for the user.
	if err := sm.RevokeAllSessionsForUser(ctx, user.ID); err != nil {
		t.Fatalf("RevokeAllSessionsForUser: %v", err)
	}

	// Use a fresh SessionManager to avoid cache interference.
	sm2 := auth.NewSessionManager(drv, true)

	// All 3 sessions should be gone.
	for _, id := range []string{sess1.ID, sess2.ID, sess3.ID} {
		_, err := sm2.ValidateSession(ctx, id, req)
		if err == nil {
			t.Errorf("expected session %q to be revoked, but it validated successfully", id)
		}
	}
}

func TestRevokeAllSessionsForUser_EmptyUser(t *testing.T) {
	drv := setupTestStore(t)
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	// Revoking sessions for a user with no sessions should succeed without error.
	if err := sm.RevokeAllSessionsForUser(ctx, "nonexistent-user-id"); err != nil {
		t.Fatalf("RevokeAllSessionsForUser (empty): %v", err)
	}
}

func TestRevokeSession_CacheEviction(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "evict_user")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Validate once to populate the cache.
	_, err = sm.ValidateSession(ctx, sess.ID, req)
	if err != nil {
		t.Fatalf("ValidateSession: %v", err)
	}

	// Revoke — should evict from cache.
	if err := sm.RevokeSession(ctx, sess.ID); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}

	// Subsequent validation on the same manager (would be a cache hit if not evicted)
	// should now fail.
	_, err = sm.ValidateSession(ctx, sess.ID, req)
	if err == nil {
		t.Fatal("expected error validating revoked session after cache eviction, got nil")
	}
}

func TestRevokeOtherSessions_ThreeSessions(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "revoke_others_user")
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
	sess3, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession 3: %v", err)
	}

	// Keep sess2, revoke everything else.
	if err := sm.RevokeOtherSessions(ctx, user.ID, sess2.ID); err != nil {
		t.Fatalf("RevokeOtherSessions: %v", err)
	}

	// Use a fresh SessionManager to bypass cache.
	sm2 := auth.NewSessionManager(drv, true)

	// sess2 should still be valid.
	_, err = sm2.ValidateSession(ctx, sess2.ID, req)
	if err != nil {
		t.Errorf("expected sess2 to remain valid: %v", err)
	}

	// sess1 and sess3 should be gone.
	for _, id := range []string{sess1.ID, sess3.ID} {
		_, err := sm2.ValidateSession(ctx, id, req)
		if err == nil {
			t.Errorf("expected session %q to be revoked, but it validated successfully", id)
		}
	}
}

func TestRevokeOtherSessions_CacheEviction(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "revoke_others_cache_user")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")
	sessKeep, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession (keep): %v", err)
	}
	sessRevoke, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession (revoke): %v", err)
	}

	// Populate cache for both sessions.
	_, err = sm.ValidateSession(ctx, sessKeep.ID, req)
	if err != nil {
		t.Fatalf("ValidateSession (keep): %v", err)
	}
	_, err = sm.ValidateSession(ctx, sessRevoke.ID, req)
	if err != nil {
		t.Fatalf("ValidateSession (revoke): %v", err)
	}

	// Revoke all except sessKeep — evicts sessRevoke from cache.
	if err := sm.RevokeOtherSessions(ctx, user.ID, sessKeep.ID); err != nil {
		t.Fatalf("RevokeOtherSessions: %v", err)
	}

	// sessRevoke should be gone even with cache-hot manager (evicted).
	_, err = sm.ValidateSession(ctx, sessRevoke.ID, req)
	if err == nil {
		t.Fatal("expected revoked session to be gone from cache, but it validated successfully")
	}

	// sessKeep should still work from cache.
	_, err = sm.ValidateSession(ctx, sessKeep.ID, req)
	if err != nil {
		t.Errorf("expected kept session to remain valid: %v", err)
	}
}

func TestCleanupExpired_MultipleExpired(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "cleanup_multi_user")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")

	// Create 2 valid sessions.
	valid1, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession valid1: %v", err)
	}
	valid2, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession valid2: %v", err)
	}

	// Create 2 expired sessions by recreating them with a past expiry.
	for i, prefix := range []string{"exp-a-", "exp-b-"} {
		tmp, err := sm.CreateSession(ctx, user.ID, req)
		if err != nil {
			t.Fatalf("CreateSession temp %d: %v", i, err)
		}
		tx, err := drv.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("Begin %d: %v", i, err)
		}
		if err := tx.DeleteSession(ctx, tmp.ID); err != nil {
			_ = tx.Rollback()
			t.Fatalf("DeleteSession %d: %v", i, err)
		}
		_ = prefix
		expSess := &store.Session{
			ID:          tmp.ID,
			UserID:      user.ID,
			Fingerprint: tmp.Fingerprint,
			ExpiresAt:   time.Now().Add(-2 * time.Hour).UTC(),
			LastActive:  time.Now().Add(-2 * time.Hour).UTC(),
			IPAddress:   tmp.IPAddress,
			UserAgent:   tmp.UserAgent,
		}
		if _, err := tx.CreateSession(ctx, expSess); err != nil {
			_ = tx.Rollback()
			t.Fatalf("CreateSession (expired %d): %v", i, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("Commit %d: %v", i, err)
		}
	}

	// Cleanup should remove the 2 expired sessions.
	n, err := sm.CleanupExpired(ctx)
	if err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}
	if n != 2 {
		t.Errorf("CleanupExpired deleted %d rows, want 2", n)
	}

	// Both valid sessions should still be present.
	sm2 := auth.NewSessionManager(drv, true)
	for _, id := range []string{valid1.ID, valid2.ID} {
		_, err := sm2.ValidateSession(ctx, id, req)
		if err != nil {
			t.Errorf("expected valid session %q to survive cleanup: %v", id, err)
		}
	}
}

func TestCleanupExpired_NoneExpired(t *testing.T) {
	drv := setupTestStore(t)
	user := createTestUser(t, drv, "cleanup_none_user")
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	req := fakeRequest("Mozilla/5.0", "en-US")

	// Create only valid sessions.
	_, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	n, err := sm.CleanupExpired(ctx)
	if err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}
	if n != 0 {
		t.Errorf("CleanupExpired deleted %d rows, want 0", n)
	}
}

func TestStartCleanupWorker_ExitsOnContextCancel(t *testing.T) {
	drv := setupTestStore(t)
	sm := auth.NewSessionManager(drv, true)

	ctx, cancel := context.WithCancel(context.Background())

	// Start the worker — it ticks every hour, so it won't fire during the test.
	sm.StartCleanupWorker(ctx)

	// Cancel the context after a short delay; the goroutine should exit cleanly.
	cancel()

	// Give the goroutine time to observe the cancellation. In practice it
	// exits immediately on the next select iteration.
	time.Sleep(50 * time.Millisecond)

	// If the goroutine is still running it will be detected by the race detector
	// or cause a test timeout; reaching here without hanging is the assertion.
}

func TestStartCleanupWorker_MultipleWorkers(t *testing.T) {
	drv := setupTestStore(t)
	sm := auth.NewSessionManager(drv, true)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Starting multiple workers should not panic.
	sm.StartCleanupWorker(ctx)
	sm.StartCleanupWorker(ctx)
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

	// Test SetCookie with no domain (path mode).
	w := httptest.NewRecorder()
	sm.SetCookie(w, "test-session-id", auth.CookieOptions{})

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
	if c.Domain != "" {
		t.Errorf("expected no Domain in path mode, got %q", c.Domain)
	}

	// Test ClearCookie with no domain.
	w2 := httptest.NewRecorder()
	sm.ClearCookie(w2, auth.CookieOptions{})

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
	smDev.SetCookie(w3, "dev-session", auth.CookieOptions{})
	cookies3 := w3.Result().Cookies()
	if len(cookies3) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies3))
	}
	if cookies3[0].Secure {
		t.Error("expected Secure=false in dev mode")
	}
}

func TestCookieOptionsForTenant(t *testing.T) {
	tests := []struct {
		name         string
		urlMode      string
		parentDomain string
		wantDomain   string
		wantSubdomain bool
	}{
		{
			name:          "path mode — no domain",
			urlMode:       "path",
			parentDomain:  "",
			wantDomain:    "",
			wantSubdomain: false,
		},
		{
			name:          "subdomain mode without parent — no domain",
			urlMode:       "subdomain",
			parentDomain:  "",
			wantDomain:    "",
			wantSubdomain: false,
		},
		{
			name:          "subdomain mode with parent domain",
			urlMode:       "subdomain",
			parentDomain:  "localhost",
			wantDomain:    ".localhost",
			wantSubdomain: true,
		},
		{
			name:          "subdomain mode with leading-dot domain (idempotent)",
			urlMode:       "subdomain",
			parentDomain:  ".example.com",
			wantDomain:    ".example.com",
			wantSubdomain: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := auth.CookieOptionsForTenant(tc.urlMode, tc.parentDomain)
			if got.Domain != tc.wantDomain {
				t.Errorf("Domain = %q, want %q", got.Domain, tc.wantDomain)
			}
			if got.Subdomain != tc.wantSubdomain {
				t.Errorf("Subdomain = %v, want %v", got.Subdomain, tc.wantSubdomain)
			}
		})
	}
}

func TestSetCookieSubdomainMode(t *testing.T) {
	drv := setupTestStore(t)
	sm := auth.NewSessionManager(drv, false)

	opts := auth.CookieOptionsForTenant("subdomain", "localhost")

	// SetCookie in subdomain mode: Domain=.localhost, SameSite=Lax.
	w := httptest.NewRecorder()
	sm.SetCookie(w, "sub-session-id", opts)

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies))
	}
	c := cookies[0]
	// Go's net/http strips the leading dot per RFC 6265 §4.1.1 — the
	// parsed Domain field will be "localhost" not ".localhost".
	if c.Domain != "localhost" {
		t.Errorf("Domain = %q, want %q", c.Domain, "localhost")
	}
	// SameSite=Lax required per spec §4.3 for subdomain cookie sharing.
	if c.SameSite != http.SameSiteLaxMode {
		t.Errorf("SameSite = %v, want Lax", c.SameSite)
	}

	// Verify the raw Set-Cookie header contains a Domain attribute.
	// Go's net/http serialises Domain without the leading dot per RFC 6265.
	rawHeader := w.Header().Get("Set-Cookie")
	if rawHeader == "" {
		t.Fatal("expected Set-Cookie header")
	}
	if !strings.Contains(rawHeader, "Domain=localhost") {
		t.Errorf("Set-Cookie header %q should contain Domain=localhost", rawHeader)
	}

	// ClearCookie in subdomain mode: same Domain to ensure browser evicts.
	w2 := httptest.NewRecorder()
	sm.ClearCookie(w2, opts)
	cookies2 := w2.Result().Cookies()
	if len(cookies2) != 1 {
		t.Fatalf("expected 1 cookie on clear, got %d", len(cookies2))
	}
	// Same RFC 6265 stripping applies.
	if cookies2[0].Domain != "localhost" {
		t.Errorf("clear Domain = %q, want %q", cookies2[0].Domain, "localhost")
	}
	if cookies2[0].MaxAge != -1 {
		t.Errorf("clear MaxAge = %d, want -1", cookies2[0].MaxAge)
	}
}
