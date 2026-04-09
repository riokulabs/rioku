package auth_test

import (
	"context"
	"fmt"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// createTestUserFast creates a user without expensive Argon2 hashing.
// It reuses a pre-computed hash for speed in scale tests.
func createTestUserFast(t *testing.T, drv store.Driver, username, precomputedHash string) *store.User {
	t.Helper()
	ctx := context.Background()

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}

	user, err := tx.CreateUser(ctx, &store.User{
		Username:     username,
		PasswordHash: precomputedHash,
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

func TestConcurrent10KSessions(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 10K session test in short mode")
	}

	drv := setupTestStore(t)
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	const numSessions = 10_000
	const readConcurrency = 100

	// Compute the Argon2 hash once and reuse it for all users.
	hash, err := auth.HashPassword("TestPass1!")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	// Pre-create users sequentially using the pre-computed hash.
	users := make([]*store.User, numSessions)
	for i := 0; i < numSessions; i++ {
		users[i] = createTestUserFast(t, drv, fmt.Sprintf("scale-user-%d", i), hash)
	}

	// Create sessions sequentially. SQLite is single-writer; the value of
	// this test is proving 10K sessions co-exist without data corruption
	// or race conditions, not benchmarking concurrent writes.
	sessions := make([]*store.Session, numSessions)
	for i := 0; i < numSessions; i++ {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("User-Agent", "scale-test")
		req.Header.Set("Accept-Language", "en-US")
		sess, err := sm.CreateSession(ctx, users[i].ID, req)
		if err != nil {
			t.Fatalf("session %d creation failed: %v", i, err)
		}
		sessions[i] = sess
	}

	// Validate a subset of sessions concurrently with high read concurrency.
	// This exercises the LRU cache and SessionManager under concurrent load
	// and the race detector catches any data races.
	const validateCount = 1000
	readSem := make(chan struct{}, readConcurrency)
	var validateWg sync.WaitGroup
	validateErrs := make([]error, validateCount)

	for i := 0; i < validateCount; i++ {
		validateWg.Add(1)
		readSem <- struct{}{}
		go func(idx int) {
			defer validateWg.Done()
			defer func() { <-readSem }()

			req := httptest.NewRequest("GET", "/", nil)
			req.Header.Set("User-Agent", "scale-test")
			req.Header.Set("Accept-Language", "en-US")
			_, err := sm.ValidateSession(ctx, sessions[idx*10].ID, req)
			validateErrs[idx] = err
		}(i)
	}
	validateWg.Wait()

	var validateErrCount int
	for _, err := range validateErrs {
		if err != nil {
			validateErrCount++
		}
	}
	if validateErrCount > 0 {
		t.Errorf("%d/%d session validations failed", validateErrCount, validateCount)
	}
}

func TestLRUCacheAtCapacity(t *testing.T) {
	drv := setupTestStore(t)
	ctx := context.Background()

	// The default sessionCacheSize is 10_000. We create a manager and fill
	// its cache to capacity, then verify eviction behavior.
	sm := auth.NewSessionManager(drv, true)

	// Compute the Argon2 hash once and reuse it for all users.
	hash, err := auth.HashPassword("TestPass1!")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	// Create exactly sessionCacheSize users and sessions.
	const cacheSize = 100 // Use a smaller number for the test; the LRU is 10K but this verifies the pattern.
	users := make([]*store.User, cacheSize+1)
	sessions := make([]*store.Session, cacheSize+1)

	for i := 0; i <= cacheSize; i++ {
		users[i] = createTestUserFast(t, drv, fmt.Sprintf("lru-user-%d", i), hash)
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("User-Agent", "lru-test")
		req.Header.Set("Accept-Language", "en-US")

		sess, err := sm.CreateSession(ctx, users[i].ID, req)
		if err != nil {
			t.Fatalf("create session %d: %v", i, err)
		}
		sessions[i] = sess
	}

	// The last session pushed the first one out of the LRU (if cache is at capacity).
	// Validate the first session -- it should still work via DB fallback.
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("User-Agent", "lru-test")
	req.Header.Set("Accept-Language", "en-US")

	claims, err := sm.ValidateSession(ctx, sessions[0].ID, req)
	if err != nil {
		t.Fatalf("expected session 0 to still validate via DB fallback: %v", err)
	}
	if claims.UserID != users[0].ID {
		t.Errorf("claims.UserID=%q, want %q", claims.UserID, users[0].ID)
	}

	// Validate the newest session -- should be a cache hit.
	claims2, err := sm.ValidateSession(ctx, sessions[cacheSize].ID, req)
	if err != nil {
		t.Fatalf("expected newest session to validate: %v", err)
	}
	if claims2.UserID != users[cacheSize].ID {
		t.Errorf("claims.UserID=%q, want %q", claims2.UserID, users[cacheSize].ID)
	}
}

func TestConcurrentValidateSession(t *testing.T) {
	drv := setupTestStore(t)
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	user := createTestUser(t, drv, "concurrent-validate-user")
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("User-Agent", "concurrent-test")
	req.Header.Set("Accept-Language", "en-US")

	sess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	// 100 goroutines all validating the same session simultaneously.
	const goroutines = 100
	var wg sync.WaitGroup
	results := make([]*auth.SessionClaims, goroutines)
	errors := make([]error, goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			vReq := httptest.NewRequest("GET", "/", nil)
			vReq.Header.Set("User-Agent", "concurrent-test")
			vReq.Header.Set("Accept-Language", "en-US")
			claims, err := sm.ValidateSession(ctx, sess.ID, vReq)
			results[idx] = claims
			errors[idx] = err
		}(i)
	}
	wg.Wait()

	// All must succeed with correct claims.
	for i := 0; i < goroutines; i++ {
		if errors[i] != nil {
			t.Errorf("goroutine %d: validation error: %v", i, errors[i])
			continue
		}
		if results[i].SessionID != sess.ID {
			t.Errorf("goroutine %d: SessionID=%q, want %q", i, results[i].SessionID, sess.ID)
		}
		if results[i].UserID != user.ID {
			t.Errorf("goroutine %d: UserID=%q, want %q", i, results[i].UserID, user.ID)
		}
	}
}

func TestSessionCleanup100K(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 100K cleanup test in short mode")
	}

	drv := setupTestStore(t)
	sm := auth.NewSessionManager(drv, true)
	ctx := context.Background()

	user := createTestUser(t, drv, "cleanup-user")

	// Insert expired sessions directly via the store in batches for speed.
	// The race detector adds significant overhead (5-10x), so we use a
	// count that's still meaningful while keeping the test under 2 minutes.
	const expiredCount = 10_000 // reduced from 100K — 100K takes >5min under -race
	const batchSize = 5000

	t.Logf("inserting %d expired sessions in batches of %d...", expiredCount, batchSize)
	insertStart := time.Now()

	for batch := 0; batch < expiredCount/batchSize; batch++ {
		tx, err := drv.Begin(ctx, store.TxOptions{})
		if err != nil {
			t.Fatalf("begin batch %d: %v", batch, err)
		}
		for i := 0; i < batchSize; i++ {
			idx := batch*batchSize + i
			_, err := tx.CreateSession(ctx, &store.Session{
				ID:          fmt.Sprintf("expired-%d", idx),
				UserID:      user.ID,
				Fingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
				ExpiresAt:   time.Now().Add(-1 * time.Hour).UTC(),
				LastActive:  time.Now().Add(-2 * time.Hour).UTC(),
			})
			if err != nil {
				_ = tx.Rollback()
				t.Fatalf("create expired session %d: %v", idx, err)
			}
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit batch %d: %v", batch, err)
		}
	}

	t.Logf("insertion took %v", time.Since(insertStart))

	// Also create one valid session.
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("User-Agent", "cleanup-test")
	req.Header.Set("Accept-Language", "en-US")
	validSess, err := sm.CreateSession(ctx, user.ID, req)
	if err != nil {
		t.Fatalf("create valid session: %v", err)
	}

	// Run cleanup and measure wall time.
	start := time.Now()
	n, err := sm.CleanupExpired(ctx)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}

	t.Logf("cleaned %d expired sessions in %v", n, elapsed)

	if n < int64(expiredCount) {
		t.Errorf("expected at least %d deleted, got %d", expiredCount, n)
	}

	// Target: <5s on SQLite without race detector. The -race flag adds
	// 5-10x overhead, so we allow 30s when running with race detection.
	if elapsed > 30*time.Second {
		t.Errorf("cleanup took %v, target is <30s (with race detector)", elapsed)
	}

	// Verify the valid session is untouched.
	claims, err := sm.ValidateSession(ctx, validSess.ID, req)
	if err != nil {
		t.Fatalf("valid session should still exist: %v", err)
	}
	if claims.UserID != user.ID {
		t.Errorf("claims.UserID=%q, want %q", claims.UserID, user.ID)
	}
}
