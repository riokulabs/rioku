package circuitbreaker

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

// provisioned returns a freshly-provisioned CircuitBreaker with
// caller-supplied overrides applied. It bails the test on provision
// or validate errors.
func provisioned(t *testing.T, c *CircuitBreaker) {
	t.Helper()
	ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
	t.Cleanup(cancel)
	if err := c.Provision(ctx); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

// nextWithStatus returns a handler that always writes the supplied
// status code.
func nextWithStatus(code int) caddyhttp.Handler {
	return caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		w.WriteHeader(code)
		return nil
	})
}

// nextErroring returns a handler that returns the supplied error
// without writing any status — simulating a transport-level failure
// where the upstream never responded.
func nextErroring(err error) caddyhttp.Handler {
	return caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		return err
	})
}

func newReq() (*http.Request, *httptest.ResponseRecorder) {
	return httptest.NewRequest("GET", "http://x/", nil), httptest.NewRecorder()
}

func TestCircuitBreaker_ClosedToOpen_OnConsecutiveFailures(t *testing.T) {
	c := &CircuitBreaker{FailureThreshold: 3, TimeoutSeconds: 30}
	provisioned(t, c)

	// FailureThreshold-1 failures: still closed, requests forwarded.
	for i := 0; i < 2; i++ {
		req, rec := newReq()
		if err := c.ServeHTTP(rec, req, nextWithStatus(503)); err != nil {
			t.Fatalf("ServeHTTP: %v", err)
		}
		if rec.Code != 503 {
			t.Fatalf("iter %d: status = %d, want 503 (forwarded from upstream)", i, rec.Code)
		}
	}
	if c.curState != stateClosed {
		t.Fatalf("state = %s, want closed before threshold reached", c.curState)
	}

	// Third failure trips the breaker.
	req, rec := newReq()
	if err := c.ServeHTTP(rec, req, nextWithStatus(503)); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if c.curState != stateOpen {
		t.Fatalf("state = %s, want open after FailureThreshold consecutive failures", c.curState)
	}

	// Next request must be short-circuited with 503 + Retry-After.
	req, rec = newReq()
	if err := c.ServeHTTP(rec, req, nextWithStatus(200)); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 from open breaker", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got == "" {
		t.Fatal("Retry-After header missing on open-state rejection")
	} else if n, err := strconv.Atoi(got); err != nil || n < 1 {
		t.Fatalf("Retry-After = %q, want positive integer seconds", got)
	}
}

func TestCircuitBreaker_HandlerErrorCountsAsFailure(t *testing.T) {
	c := &CircuitBreaker{FailureThreshold: 2, TimeoutSeconds: 30}
	provisioned(t, c)

	upstreamErr := errors.New("connection refused")
	for i := 0; i < 2; i++ {
		req, rec := newReq()
		// Errors must propagate up — handler errors are
		// preserved by the breaker; only the state machine
		// counts the failure.
		if err := c.ServeHTTP(rec, req, nextErroring(upstreamErr)); err != upstreamErr {
			t.Fatalf("iter %d: err = %v, want %v", i, err, upstreamErr)
		}
	}
	if c.curState != stateOpen {
		t.Fatalf("state = %s, want open after 2 handler errors", c.curState)
	}
}

func TestCircuitBreaker_SuccessInClosedResetsCounter(t *testing.T) {
	c := &CircuitBreaker{FailureThreshold: 3, TimeoutSeconds: 30}
	provisioned(t, c)

	// 2 failures, then a success — counter must reset, so next 2
	// failures alone should NOT trip the breaker.
	for i := 0; i < 2; i++ {
		req, rec := newReq()
		_ = c.ServeHTTP(rec, req, nextWithStatus(500))
	}
	req, rec := newReq()
	_ = c.ServeHTTP(rec, req, nextWithStatus(200))
	if c.consecFailures != 0 {
		t.Fatalf("consecFailures = %d, want 0 after success in closed state", c.consecFailures)
	}

	for i := 0; i < 2; i++ {
		req, rec := newReq()
		_ = c.ServeHTTP(rec, req, nextWithStatus(500))
	}
	if c.curState != stateClosed {
		t.Fatalf("state = %s, want still closed; success should have reset counter", c.curState)
	}
}

func TestCircuitBreaker_OpenAfterTimeout_HalfOpenAdmitsOneProbe(t *testing.T) {
	c := &CircuitBreaker{FailureThreshold: 1, TimeoutSeconds: 1, HalfOpenRequests: 1}
	provisioned(t, c)

	// Force open.
	req, rec := newReq()
	_ = c.ServeHTTP(rec, req, nextWithStatus(500))
	if c.curState != stateOpen {
		t.Fatalf("state = %s, want open", c.curState)
	}

	// Reach into the breaker to backdate openedAt so we don't have
	// to actually sleep for TimeoutSeconds in the test. The
	// timer comparison uses time.Now() each call, so this is
	// indistinguishable from real elapsed time.
	c.mu.Lock()
	c.openedAt = time.Now().Add(-2 * time.Second)
	c.mu.Unlock()

	// First request after cooldown is the admitted probe. Block
	// it inside the handler so the second concurrent request
	// hits the "all probe slots taken" branch.
	probeStarted := make(chan struct{})
	probeRelease := make(chan struct{})
	probeHandler := caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		close(probeStarted)
		<-probeRelease
		w.WriteHeader(200)
		return nil
	})

	probeDone := make(chan error, 1)
	go func() {
		req, rec := newReq()
		probeDone <- c.ServeHTTP(rec, req, probeHandler)
	}()

	<-probeStarted
	if c.curState != stateHalfOpen {
		t.Fatalf("state = %s, want half_open after probe admitted", c.curState)
	}

	// Second concurrent request must be rejected because the
	// only probe slot is busy.
	req, rec = newReq()
	if err := c.ServeHTTP(rec, req, nextWithStatus(200)); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 for excess half-open probe", rec.Code)
	}

	close(probeRelease)
	if err := <-probeDone; err != nil {
		t.Fatalf("probe ServeHTTP: %v", err)
	}

	// SuccessThreshold defaults to 1, so the successful probe
	// should have closed the breaker.
	if c.curState != stateClosed {
		t.Fatalf("state = %s, want closed after successful probe", c.curState)
	}
}

func TestCircuitBreaker_HalfOpenSuccess_ClosesAfterSuccessThreshold(t *testing.T) {
	// SuccessThreshold=3 means three consecutive successful probes in
	// half-open are required to close the breaker. HalfOpenRequests=3
	// gives us enough probe slots that we can fire three back-to-back
	// without the second one being rejected as "all probe slots
	// taken". Probes are released by the time the next request runs
	// (sequential, not concurrent), so the in-flight counter never
	// pegs at the limit.
	c := &CircuitBreaker{
		FailureThreshold:  1,
		TimeoutSeconds:    1,
		SuccessThreshold:  3,
		HalfOpenRequests:  3,
	}
	provisioned(t, c)

	// Trip open.
	req, rec := newReq()
	_ = c.ServeHTTP(rec, req, nextWithStatus(500))
	if c.curState != stateOpen {
		t.Fatalf("state = %s, want open after first failure", c.curState)
	}

	// Cool down so the next request promotes to half-open.
	c.mu.Lock()
	c.openedAt = time.Now().Add(-2 * time.Second)
	c.mu.Unlock()

	// First probe: transitions open -> half-open and counts as 1
	// success. Should remain half-open.
	req, rec = newReq()
	if err := c.ServeHTTP(rec, req, nextWithStatus(200)); err != nil {
		t.Fatalf("probe 1: %v", err)
	}
	if c.curState != stateHalfOpen {
		t.Fatalf("after probe 1: state = %s, want half_open", c.curState)
	}

	// Second probe: still half-open, 2 successes recorded.
	req, rec = newReq()
	if err := c.ServeHTTP(rec, req, nextWithStatus(200)); err != nil {
		t.Fatalf("probe 2: %v", err)
	}
	if c.curState != stateHalfOpen {
		t.Fatalf("after probe 2: state = %s, want half_open", c.curState)
	}

	// Third probe: hits SuccessThreshold, breaker closes.
	req, rec = newReq()
	if err := c.ServeHTTP(rec, req, nextWithStatus(200)); err != nil {
		t.Fatalf("probe 3: %v", err)
	}
	if c.curState != stateClosed {
		t.Fatalf("after probe 3: state = %s, want closed", c.curState)
	}
}

func TestCircuitBreaker_HalfOpenFailure_ReopensBreaker(t *testing.T) {
	c := &CircuitBreaker{FailureThreshold: 1, TimeoutSeconds: 1}
	provisioned(t, c)

	// Trip open.
	req, rec := newReq()
	_ = c.ServeHTTP(rec, req, nextWithStatus(500))

	// Cool down so the next request goes to half-open.
	c.mu.Lock()
	c.openedAt = time.Now().Add(-2 * time.Second)
	c.mu.Unlock()

	// Probe fails — breaker must re-open.
	req, rec = newReq()
	_ = c.ServeHTTP(rec, req, nextWithStatus(502))
	if c.curState != stateOpen {
		t.Fatalf("state = %s, want open after failed half-open probe", c.curState)
	}

	// Subsequent request still rejected with 503.
	req, rec = newReq()
	_ = c.ServeHTTP(rec, req, nextWithStatus(200))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 after re-open", rec.Code)
	}
}

// TestCircuitBreaker_ConcurrentFailures_DontDoubleCount proves the
// state machine is mutex-safe: 100 goroutines each register a
// failure simultaneously, and the breaker must end up in the open
// state. The internal consecFailures counter is allowed to overshoot
// FailureThreshold (the lock is released between admit and
// recordResult), but the state must NOT bounce or skip — it should
// transition to open exactly once, and stay there.
func TestCircuitBreaker_ConcurrentFailures_DontDoubleCount(t *testing.T) {
	const N = 100
	const threshold = 5
	c := &CircuitBreaker{FailureThreshold: threshold, TimeoutSeconds: 30}
	provisioned(t, c)

	failingHandler := caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		w.WriteHeader(500)
		return nil
	})

	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			req, rec := newReq()
			_ = c.ServeHTTP(rec, req, failingHandler)
		}()
	}
	close(start)
	wg.Wait()

	if c.curState != stateOpen {
		t.Fatalf("state = %s, want open after concurrent failures", c.curState)
	}
	// Exactly one closed→open transition fires inside
	// recordResult. The breaker's internal counter is the
	// only race-free witness; observing before/after via
	// snapshotState across the ServeHTTP call boundary is a
	// TOCTOU so flaky in practice.
	if got := c.observedClosedToOpenTransitions(); got != 1 {
		t.Fatalf("closed->open transitions = %d, want exactly 1", got)
	}
}

// snapshotState returns the current state under lock.
func (c *CircuitBreaker) snapshotState() state {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.curState
}

// observedClosedToOpenTransitions returns the count of closed→open
// transitions that have actually fired inside recordResult. Read
// under the same lock that increments it so the test sees a
// consistent value.
func (c *CircuitBreaker) observedClosedToOpenTransitions() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closedToOpenTransitions
}

func TestCircuitBreaker_Provision_RejectsBadConfig(t *testing.T) {
	cases := []struct {
		name string
		c    CircuitBreaker
	}{
		{"failure_threshold_zero", CircuitBreaker{FailureThreshold: 0, TimeoutSeconds: 1}},
		{"failure_threshold_negative", CircuitBreaker{FailureThreshold: -1, TimeoutSeconds: 1}},
		{"timeout_zero", CircuitBreaker{FailureThreshold: 1, TimeoutSeconds: 0}},
		{"timeout_negative", CircuitBreaker{FailureThreshold: 1, TimeoutSeconds: -5}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := caddy.NewContext(caddy.Context{Context: t.Context()})
			defer cancel()
			if err := tc.c.Provision(ctx); err == nil {
				t.Fatal("expected provision error")
			}
		})
	}
}

func TestCircuitBreaker_Provision_AppliesDefaults(t *testing.T) {
	c := &CircuitBreaker{FailureThreshold: 3, TimeoutSeconds: 5}
	provisioned(t, c)
	if c.SuccessThreshold != 1 {
		t.Errorf("SuccessThreshold = %d, want 1 (default)", c.SuccessThreshold)
	}
	if c.HalfOpenRequests != 1 {
		t.Errorf("HalfOpenRequests = %d, want 1 (default)", c.HalfOpenRequests)
	}
	if c.BreakerName != "default" {
		t.Errorf("BreakerName = %q, want \"default\" (default)", c.BreakerName)
	}
}

func TestCircuitBreaker_OpenState_BodyNotForwarded(t *testing.T) {
	c := &CircuitBreaker{FailureThreshold: 1, TimeoutSeconds: 60}
	provisioned(t, c)

	// Trip open.
	req, rec := newReq()
	_ = c.ServeHTTP(rec, req, nextWithStatus(500))

	// Open-state request must NOT invoke the upstream. We use a
	// counter instead of a boolean so any unintended call shows
	// up in failure messages.
	var calls atomic.Int32
	upstream := caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		calls.Add(1)
		w.WriteHeader(200)
		return nil
	})
	req, rec = newReq()
	_ = c.ServeHTTP(rec, req, upstream)
	if calls.Load() != 0 {
		t.Fatalf("upstream invoked %d times, want 0 in open state", calls.Load())
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestCircuitBreaker_2xxKeepsClosed(t *testing.T) {
	c := &CircuitBreaker{FailureThreshold: 3, TimeoutSeconds: 30}
	provisioned(t, c)
	for i := 0; i < 100; i++ {
		req, rec := newReq()
		if err := c.ServeHTTP(rec, req, nextWithStatus(200)); err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
	}
	if c.curState != stateClosed {
		t.Fatalf("state = %s, want closed after 100 successes", c.curState)
	}
}

func TestCircuitBreaker_4xxNotCountedAsFailure(t *testing.T) {
	// 4xx responses are client errors — they shouldn't trip the
	// breaker. Only 5xx (server) errors and handler errors do.
	c := &CircuitBreaker{FailureThreshold: 2, TimeoutSeconds: 30}
	provisioned(t, c)

	for i := 0; i < 10; i++ {
		req, rec := newReq()
		if err := c.ServeHTTP(rec, req, nextWithStatus(404)); err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
	}
	if c.curState != stateClosed {
		t.Fatalf("state = %s, want closed; 4xx must not trip the breaker", c.curState)
	}
}
