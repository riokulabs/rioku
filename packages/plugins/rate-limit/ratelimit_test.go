package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

var nextNoOp = caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("X-Test-Forwarded", "yes")
	w.WriteHeader(http.StatusOK)
	return nil
})

func provisioned(t *testing.T, r *RateLimit) {
	t.Helper()
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := r.Provision(ctx); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := r.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

func TestRateLimit_HeaderScope_AllowsUnderLimit(t *testing.T) {
	r := &RateLimit{Limit: 3, WindowSeconds: 60, Scope: "header", HeaderName: "X-Rioku-Principal"}
	provisioned(t, r)

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("X-Rioku-Principal", "user-a")
		rec := httptest.NewRecorder()
		if err := r.ServeHTTP(rec, req, nextNoOp); err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("iter %d status = %d, want 200", i, rec.Code)
		}
		// Headers should appear on every response.
		if got := rec.Header().Get("X-RateLimit-Limit"); got != "3" {
			t.Errorf("iter %d limit header = %q, want 3", i, got)
		}
		expectedRemaining := 3 - (i + 1)
		if got := rec.Header().Get("X-RateLimit-Remaining"); got != strconv.Itoa(expectedRemaining) {
			t.Errorf("iter %d remaining header = %q, want %d", i, got, expectedRemaining)
		}
	}
}

func TestRateLimit_HeaderScope_BlocksAfterLimit(t *testing.T) {
	r := &RateLimit{Limit: 2, WindowSeconds: 60, Scope: "header", HeaderName: "X-Rioku-Principal"}
	provisioned(t, r)

	// Two allowed.
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("X-Rioku-Principal", "user-a")
		rec := httptest.NewRecorder()
		_ = r.ServeHTTP(rec, req, nextNoOp)
		if rec.Code != http.StatusOK {
			t.Fatalf("iter %d expected 200, got %d", i, rec.Code)
		}
	}
	// Third blocked.
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("X-Rioku-Principal", "user-a")
	rec := httptest.NewRecorder()
	_ = r.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got == "" {
		t.Fatal("missing Retry-After header on 429")
	}
	if rec.Header().Get("X-Test-Forwarded") != "" {
		t.Fatal("next handler should not run when blocked")
	}
}

func TestRateLimit_PerKeyIsolation(t *testing.T) {
	r := &RateLimit{Limit: 2, WindowSeconds: 60, Scope: "header", HeaderName: "X-Rioku-Principal"}
	provisioned(t, r)

	// User A burns its budget.
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("X-Rioku-Principal", "user-a")
		rec := httptest.NewRecorder()
		_ = r.ServeHTTP(rec, req, nextNoOp)
	}
	// User A is now blocked.
	reqBlocked := httptest.NewRequest("GET", "http://x/", nil)
	reqBlocked.Header.Set("X-Rioku-Principal", "user-a")
	recBlocked := httptest.NewRecorder()
	_ = r.ServeHTTP(recBlocked, reqBlocked, nextNoOp)
	if recBlocked.Code != http.StatusTooManyRequests {
		t.Fatalf("user-a not blocked: code %d", recBlocked.Code)
	}
	// User B has its own budget.
	reqOther := httptest.NewRequest("GET", "http://x/", nil)
	reqOther.Header.Set("X-Rioku-Principal", "user-b")
	recOther := httptest.NewRecorder()
	_ = r.ServeHTTP(recOther, reqOther, nextNoOp)
	if recOther.Code != http.StatusOK {
		t.Fatalf("user-b leaked from user-a's budget: code %d", recOther.Code)
	}
}

func TestRateLimit_IPScope(t *testing.T) {
	r := &RateLimit{Limit: 2, WindowSeconds: 60, Scope: "ip"}
	provisioned(t, r)

	send := func(remoteAddr string) int {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.RemoteAddr = remoteAddr
		rec := httptest.NewRecorder()
		_ = r.ServeHTTP(rec, req, nextNoOp)
		return rec.Code
	}
	for i := 0; i < 2; i++ {
		if got := send("10.0.0.1:1234"); got != http.StatusOK {
			t.Fatalf("iter %d ip a: %d", i, got)
		}
	}
	if got := send("10.0.0.1:1234"); got != http.StatusTooManyRequests {
		t.Fatalf("ip a third: %d, want 429", got)
	}
	if got := send("10.0.0.2:1234"); got != http.StatusOK {
		t.Fatalf("ip b leaked: %d", got)
	}
}

func TestRateLimit_RouteIDScope(t *testing.T) {
	r := &RateLimit{Limit: 2, WindowSeconds: 60, Scope: "route_id", RouteID: "route-checkout"}
	provisioned(t, r)

	send := func() int {
		req := httptest.NewRequest("GET", "http://x/", nil)
		rec := httptest.NewRecorder()
		_ = r.ServeHTTP(rec, req, nextNoOp)
		return rec.Code
	}
	for i := 0; i < 2; i++ {
		if got := send(); got != http.StatusOK {
			t.Fatalf("iter %d: %d", i, got)
		}
	}
	if got := send(); got != http.StatusTooManyRequests {
		t.Fatalf("third: %d, want 429", got)
	}
}

func TestRateLimit_TenantScope(t *testing.T) {
	r := &RateLimit{Limit: 2, WindowSeconds: 60, Scope: "tenant_id"}
	provisioned(t, r)

	send := func(tenant string) int {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("X-Rioku-Tenant", tenant)
		rec := httptest.NewRecorder()
		_ = r.ServeHTTP(rec, req, nextNoOp)
		return rec.Code
	}
	for i := 0; i < 2; i++ {
		if got := send("tenant-a"); got != http.StatusOK {
			t.Fatalf("iter %d: %d", i, got)
		}
	}
	if got := send("tenant-a"); got != http.StatusTooManyRequests {
		t.Fatalf("tenant-a third: %d", got)
	}
	if got := send("tenant-b"); got != http.StatusOK {
		t.Fatalf("tenant-b leaked: %d", got)
	}
}

func TestRateLimit_HeaderScope_NoValueFailsOpen(t *testing.T) {
	r := &RateLimit{Limit: 1, WindowSeconds: 60, Scope: "header", HeaderName: "X-Rioku-Principal"}
	provisioned(t, r)

	// 100 unauthenticated requests; all should pass through.
	for i := 0; i < 100; i++ {
		req := httptest.NewRequest("GET", "http://x/", nil)
		rec := httptest.NewRecorder()
		_ = r.ServeHTTP(rec, req, nextNoOp)
		if rec.Code != http.StatusOK {
			t.Fatalf("iter %d: %d (header scope without header value should fail open)", i, rec.Code)
		}
	}
}

func TestRateLimit_LogAction(t *testing.T) {
	r := &RateLimit{Limit: 1, WindowSeconds: 60, Scope: "header", HeaderName: "X-Rioku-Principal", Action: "log"}
	provisioned(t, r)

	send := func() int {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("X-Rioku-Principal", "u")
		rec := httptest.NewRecorder()
		_ = r.ServeHTTP(rec, req, nextNoOp)
		return rec.Code
	}
	for i := 0; i < 5; i++ {
		if got := send(); got != http.StatusOK {
			t.Fatalf("iter %d: %d (log action should not block)", i, got)
		}
	}
}

func TestRateLimit_WindowResets(t *testing.T) {
	r := &RateLimit{Limit: 1, WindowSeconds: 1, Scope: "header", HeaderName: "X-Rioku-Principal"}
	provisioned(t, r)

	send := func() int {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("X-Rioku-Principal", "u")
		rec := httptest.NewRecorder()
		_ = r.ServeHTTP(rec, req, nextNoOp)
		return rec.Code
	}
	if got := send(); got != http.StatusOK {
		t.Fatalf("first: %d", got)
	}
	if got := send(); got != http.StatusTooManyRequests {
		t.Fatalf("second under limit: %d", got)
	}
	time.Sleep(1100 * time.Millisecond)
	if got := send(); got != http.StatusOK {
		t.Fatalf("after window: %d, want 200 (window should reset)", got)
	}
}

func TestRateLimit_ConcurrentRequestsAreCountedAccurately(t *testing.T) {
	r := &RateLimit{Limit: 10, WindowSeconds: 60, Scope: "header", HeaderName: "X-Rioku-Principal"}
	provisioned(t, r)

	const total = 100
	var allowed, blocked int64
	var wg sync.WaitGroup
	for i := 0; i < total; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest("GET", "http://x/", nil)
			req.Header.Set("X-Rioku-Principal", "race-user")
			rec := httptest.NewRecorder()
			_ = r.ServeHTTP(rec, req, nextNoOp)
			if rec.Code == http.StatusOK {
				atomicAdd(&allowed)
			} else if rec.Code == http.StatusTooManyRequests {
				atomicAdd(&blocked)
			}
		}()
	}
	wg.Wait()
	if allowed != 10 {
		t.Fatalf("allowed = %d, want exactly 10 under limit=10", allowed)
	}
	if blocked != total-10 {
		t.Fatalf("blocked = %d, want %d", blocked, total-10)
	}
}

func TestRateLimit_RedisStorageRejectedAtProvision(t *testing.T) {
	r := &RateLimit{Limit: 1, WindowSeconds: 60, Scope: "ip", Storage: "redis"}
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	defer cancel()
	if err := r.Provision(ctx); err == nil {
		t.Fatal("expected provision error for redis storage")
	}
}

func TestRateLimit_Provision_RejectsInvalidConfig(t *testing.T) {
	cases := []struct {
		name string
		r    RateLimit
	}{
		{"zero_limit", RateLimit{WindowSeconds: 60, Scope: "ip"}},
		{"zero_window", RateLimit{Limit: 1, Scope: "ip"}},
		{"missing_scope", RateLimit{Limit: 1, WindowSeconds: 60}},
		{"unknown_scope", RateLimit{Limit: 1, WindowSeconds: 60, Scope: "weird"}},
		{"route_id_no_value", RateLimit{Limit: 1, WindowSeconds: 60, Scope: "route_id"}},
		{"unknown_action", RateLimit{Limit: 1, WindowSeconds: 60, Scope: "ip", Action: "shrug"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
			defer cancel()
			if err := tc.r.Provision(ctx); err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
		})
	}
}

func TestMemoryStore_IncrementAndReset(t *testing.T) {
	s := NewMemoryStore()
	const bucket = "b1"
	for i := 1; i <= 5; i++ {
		c, _ := s.Increment(bucket, 60*time.Second)
		if c != i {
			t.Fatalf("iter %d count = %d, want %d", i, c, i)
		}
	}
	s.Reset(bucket)
	c, _ := s.Increment(bucket, 60*time.Second)
	if c != 1 {
		t.Fatalf("after reset count = %d, want 1", c)
	}
}

// atomicAdd is a tiny indirection so the test reads cleanly.
func atomicAdd(p *int64) { addInt64(p) }

// Sprint 4 Phase 1c — when rioku_apikey stamps a Plan RPM, the
// rate-limit module clamps to the lower of (configured Limit,
// Plan RPM). A Plan RPM lower than the configured Limit overrides
// it; a Plan RPM higher does not raise the cap.
func TestRateLimit_PlanRPMHeaderClampsLower(t *testing.T) {
	r := &RateLimit{Limit: 100, WindowSeconds: 60, Scope: "header", HeaderName: "X-Rioku-Principal"}
	provisioned(t, r)

	// Plan RPM = 2, well under the configured Limit of 100.
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("X-Rioku-Principal", "user-clamped")
		req.Header.Set("X-Rioku-Plan-RPM", "2")
		rec := httptest.NewRecorder()
		if err := r.ServeHTTP(rec, req, nextNoOp); err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("iter %d status = %d, want 200", i, rec.Code)
		}
		if got := rec.Header().Get("X-RateLimit-Limit"); got != "2" {
			t.Errorf("iter %d Limit header = %q, want 2 (Plan-clamped)", i, got)
		}
	}

	// Third request blocked at the Plan RPM cap, not the route Limit.
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("X-Rioku-Principal", "user-clamped")
	req.Header.Set("X-Rioku-Plan-RPM", "2")
	rec := httptest.NewRecorder()
	_ = r.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 (clamped to Plan RPM)", rec.Code)
	}
}

func TestRateLimit_PlanRPMHigherDoesNotRaiseCap(t *testing.T) {
	r := &RateLimit{Limit: 2, WindowSeconds: 60, Scope: "header", HeaderName: "X-Rioku-Principal"}
	provisioned(t, r)

	// Plan RPM = 1000 must NOT raise the route's hard cap of 2.
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.Header.Set("X-Rioku-Principal", "user-x")
		req.Header.Set("X-Rioku-Plan-RPM", "1000")
		rec := httptest.NewRecorder()
		_ = r.ServeHTTP(rec, req, nextNoOp)
		if rec.Code != http.StatusOK {
			t.Fatalf("iter %d status = %d, want 200", i, rec.Code)
		}
	}
	req := httptest.NewRequest("GET", "http://x/", nil)
	req.Header.Set("X-Rioku-Principal", "user-x")
	req.Header.Set("X-Rioku-Plan-RPM", "1000")
	rec := httptest.NewRecorder()
	_ = r.ServeHTTP(rec, req, nextNoOp)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 (route cap honored)", rec.Code)
	}
}
