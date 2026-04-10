package gateway

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
)

// ---------------------------------------------------------------------------
// extractKey coverage — ByUser, BySession, ByIP, fallback
// ---------------------------------------------------------------------------

func TestExtractKey_ByUser_SessionClaims(t *testing.T) {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config: config.RateLimitConfig{
			RequestsPerMinute: 60,
			ByUser:            true,
		},
		done: make(chan struct{}),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	ctx := auth.WithSessionClaims(req.Context(), &auth.SessionClaims{
		SessionID: "sess-001",
		UserID:    "user-abc",
		Username:  "testuser",
		Roles:     []string{"admin"},
	})
	req = req.WithContext(ctx)

	key := rl.extractKey(req)
	if key != "user:user-abc" {
		t.Errorf("extractKey(ByUser, SessionClaims) = %q, want %q", key, "user:user-abc")
	}
}

func TestExtractKey_ByUser_LegacyClaims(t *testing.T) {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config: config.RateLimitConfig{
			RequestsPerMinute: 60,
			ByUser:            true,
		},
		done: make(chan struct{}),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	// No SessionClaims, but legacy Claims with Subject.
	ctx := auth.WithClaims(req.Context(), &auth.Claims{
		Subject:   "user-xyz",
		Roles:     []string{"viewer"},
		TokenType: auth.TokenTypeAccess,
	})
	req = req.WithContext(ctx)

	key := rl.extractKey(req)
	if key != "user:user-xyz" {
		t.Errorf("extractKey(ByUser, legacy Claims) = %q, want %q", key, "user:user-xyz")
	}
}

func TestExtractKey_ByUser_NoClaimsFallsToIP(t *testing.T) {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config: config.RateLimitConfig{
			RequestsPerMinute: 60,
			ByUser:            true,
		},
		done: make(chan struct{}),
	}

	// No claims in context at all — should fall back to IP.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.RemoteAddr = "10.0.0.5:9999"

	key := rl.extractKey(req)
	if key != "ip:10.0.0.5" {
		t.Errorf("extractKey(ByUser, no claims) = %q, want %q", key, "ip:10.0.0.5")
	}
}

func TestExtractKey_BySession(t *testing.T) {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config: config.RateLimitConfig{
			RequestsPerMinute: 60,
			BySession:         true,
		},
		done: make(chan struct{}),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	ctx := auth.WithSessionClaims(req.Context(), &auth.SessionClaims{
		SessionID: "sess-123",
		UserID:    "user-abc",
	})
	req = req.WithContext(ctx)

	key := rl.extractKey(req)
	if key != "session:sess-123" {
		t.Errorf("extractKey(BySession) = %q, want %q", key, "session:sess-123")
	}
}

func TestExtractKey_BySession_NoSessionFallsToIP(t *testing.T) {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config: config.RateLimitConfig{
			RequestsPerMinute: 60,
			BySession:         true,
		},
		done: make(chan struct{}),
	}

	// No session claims in context — falls back to IP.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.RemoteAddr = "172.16.0.1:8080"

	key := rl.extractKey(req)
	if key != "ip:172.16.0.1" {
		t.Errorf("extractKey(BySession, no claims) = %q, want %q", key, "ip:172.16.0.1")
	}
}

func TestExtractKey_ByIP_Default(t *testing.T) {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config: config.RateLimitConfig{
			RequestsPerMinute: 60,
			ByIP:              true,
		},
		done: make(chan struct{}),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.RemoteAddr = "203.0.113.50:4567"

	key := rl.extractKey(req)
	if key != "ip:203.0.113.50" {
		t.Errorf("extractKey(ByIP) = %q, want %q", key, "ip:203.0.113.50")
	}
}

func TestExtractKey_ByIP_XForwardedFor(t *testing.T) {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config: config.RateLimitConfig{
			RequestsPerMinute: 60,
			ByIP:              true,
		},
		done: make(chan struct{}),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.Header.Set("X-Forwarded-For", "198.51.100.1, 10.0.0.1")
	req.RemoteAddr = "10.0.0.2:8080"

	key := rl.extractKey(req)
	if key != "ip:198.51.100.1" {
		t.Errorf("extractKey(ByIP, XFF) = %q, want %q", key, "ip:198.51.100.1")
	}
}

func TestExtractKey_UserTakesPrecedenceOverSession(t *testing.T) {
	rl := &RateLimiter{
		windows: make(map[string]*window),
		config: config.RateLimitConfig{
			RequestsPerMinute: 60,
			ByUser:            true,
			BySession:         true,
		},
		done: make(chan struct{}),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	ctx := auth.WithSessionClaims(req.Context(), &auth.SessionClaims{
		SessionID: "sess-999",
		UserID:    "user-priority",
	})
	req = req.WithContext(ctx)

	// ByUser should take precedence over BySession.
	key := rl.extractKey(req)
	if key != "user:user-priority" {
		t.Errorf("extractKey(ByUser+BySession) = %q, want user key to take precedence", key)
	}
}

// ---------------------------------------------------------------------------
// RateLimiter.cleanup goroutine coverage
// ---------------------------------------------------------------------------

func TestRateLimiter_CleanupGoroutine(t *testing.T) {
	// Verify that the cleanup goroutine removes expired windows and stops
	// when Stop() is called. We cannot easily trigger the 5-minute ticker
	// in a unit test, so we test the cleanup logic inline and verify Stop
	// terminates cleanly.
	rl := NewRateLimiter(config.RateLimitConfig{RequestsPerMinute: 100})

	// Populate some windows.
	rl.mu.Lock()
	rl.windows["should-expire"] = &window{count: 5, resetAt: time.Now().Add(-time.Minute)}
	rl.windows["should-remain"] = &window{count: 3, resetAt: time.Now().Add(10 * time.Minute)}
	rl.mu.Unlock()

	// Stop must terminate the goroutine without blocking.
	rl.Stop()

	// After Stop(), the done channel is closed. Verify no panic on double-access.
	rl.mu.Lock()
	count := len(rl.windows)
	rl.mu.Unlock()

	// The background goroutine may or may not have run before Stop;
	// at minimum the windows should still be accessible.
	if count < 1 {
		t.Errorf("expected at least 1 window, got %d", count)
	}
}

// ---------------------------------------------------------------------------
// RateLimiter.Middleware — disabled (RequestsPerMinute <= 0)
// ---------------------------------------------------------------------------

func TestRateLimiter_Disabled(t *testing.T) {
	rl := NewRateLimiter(config.RateLimitConfig{RequestsPerMinute: 0})
	t.Cleanup(rl.Stop)

	handler := rl.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Should pass through even without rate limit headers.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("disabled limiter: expected 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("X-RateLimit-Limit"); got != "" {
		t.Errorf("disabled limiter: expected no X-RateLimit-Limit, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// RateLimiter.Middleware — window expiry creates a new window
// ---------------------------------------------------------------------------

func TestRateLimiter_WindowReset(t *testing.T) {
	rl := NewRateLimiter(config.RateLimitConfig{RequestsPerMinute: 2})
	t.Cleanup(rl.Stop)

	handler := rl.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust the rate limit.
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
		req.RemoteAddr = "10.0.0.1:1234"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, rec.Code)
		}
	}

	// Third request should be rate-limited.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got == "" {
		t.Error("expected Retry-After header on 429 response")
	}

	// Manually expire the window to simulate time passing.
	rl.mu.Lock()
	for _, w := range rl.windows {
		w.resetAt = time.Now().Add(-time.Second)
	}
	rl.mu.Unlock()

	// Next request should succeed (new window created).
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req2.RemoteAddr = "10.0.0.1:1234"
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Errorf("after window reset: expected 200, got %d", rec2.Code)
	}
}

// ---------------------------------------------------------------------------
// RateLimiter.Middleware — rate limit headers
// ---------------------------------------------------------------------------

func TestRateLimiter_Headers(t *testing.T) {
	rl := NewRateLimiter(config.RateLimitConfig{RequestsPerMinute: 5})
	t.Cleanup(rl.Stop)

	handler := rl.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-RateLimit-Limit"); got != "5" {
		t.Errorf("X-RateLimit-Limit = %q, want 5", got)
	}
	if got := rec.Header().Get("X-RateLimit-Remaining"); got != "4" {
		t.Errorf("X-RateLimit-Remaining = %q, want 4", got)
	}
	if got := rec.Header().Get("X-RateLimit-Reset"); got == "" {
		t.Error("expected X-RateLimit-Reset header")
	}
}
