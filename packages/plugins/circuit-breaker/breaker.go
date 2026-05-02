// Package circuitbreaker implements the first-party Rioku circuit
// breaker Caddy module. It guards downstream upstreams from runaway
// failure cascades by tripping open after a configurable burst of
// consecutive failures, then slowly probing recovery in half-open
// state before closing again.
//
// State machine:
//
//   - closed     — all traffic flows through. Track consecutive
//                  upstream failures; when count >= FailureThreshold,
//                  trip to open.
//   - open       — every request short-circuits with 503 + Retry-After.
//                  After TimeoutSeconds elapses, the next request
//                  promotes the breaker to half-open.
//   - half-open  — admit up to HalfOpenRequests concurrent probe
//                  requests. After SuccessThreshold consecutive
//                  successes, close. Any failure re-opens. Excess
//                  probes get 503 immediately.
//
// Failure signal: ServeHTTP wraps the response writer with a recorder
// that captures the upstream's status code. A request counts as a
// failure when the recorded status is >= 500 OR when next.ServeHTTP
// returns a non-nil error.
package circuitbreaker

import (
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(CircuitBreaker{})
	httpcaddyfile.RegisterHandlerDirective("rioku_circuit_breaker", parseCaddyfileHandler)
}

// State enumerates the three classic circuit-breaker states.
type state int

const (
	stateClosed state = iota
	stateOpen
	stateHalfOpen
)

func (s state) String() string {
	switch s {
	case stateClosed:
		return "closed"
	case stateOpen:
		return "open"
	case stateHalfOpen:
		return "half_open"
	default:
		return "unknown"
	}
}

// CircuitBreaker is a Caddy handler that wraps a downstream chain
// with classic circuit-breaker semantics. Configuration is per-route;
// each module instance owns its own state machine. To share state
// across multiple routes, instantiate the module with the same
// BreakerName at each route — note however that v1 keeps state
// in-process per-instance; cross-instance sharing is a follow-up.
type CircuitBreaker struct {
	// FailureThreshold is the number of consecutive upstream
	// failures (status >= 500 or non-nil handler error) that must
	// occur in the closed state before the breaker trips open.
	// Required (must be > 0).
	FailureThreshold int `json:"failure_threshold,omitempty"`

	// SuccessThreshold is the number of consecutive successful
	// probes required in the half-open state before the breaker
	// returns to closed. Defaults to 1.
	SuccessThreshold int `json:"success_threshold,omitempty"`

	// TimeoutSeconds is how long the breaker stays open before
	// transitioning to half-open. Required (must be > 0). The
	// transition happens lazily on the next request — no
	// background goroutine is involved.
	TimeoutSeconds int `json:"timeout_seconds,omitempty"`

	// HalfOpenRequests is the maximum number of concurrent probe
	// requests allowed while in the half-open state. Excess
	// probes get an immediate 503. Defaults to 1.
	HalfOpenRequests int `json:"half_open_requests,omitempty"`

	// BreakerName is an optional label used in logs and metrics
	// to identify the breaker. Defaults to "default".
	BreakerName string `json:"breaker_name,omitempty"`

	logger *zap.Logger

	mu               sync.Mutex
	curState         state
	consecFailures   int
	consecSuccesses  int
	openedAt         time.Time
	halfOpenInFlight int

	// closedToOpenTransitions counts how many times the breaker
	// has crossed from closed → open. Bumped under mu inside
	// recordResult; surfaced via observedClosedToOpenTransitions
	// for tests that need to verify the transition fires exactly
	// once under concurrent load (the snapshot-before / snapshot-
	// after test pattern is racy because two goroutines can both
	// observe before=closed and after=open even when only one
	// of them caused the transition).
	closedToOpenTransitions int64
}

// CaddyModule registers the handler under
// http.handlers.rioku_circuit_breaker.
func (CircuitBreaker) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_circuit_breaker",
		New: func() caddy.Module { return new(CircuitBreaker) },
	}
}

// Provision sets default values and validates the configuration.
// Failure to validate at provision time fails fast at config load —
// callers learn at config-apply time, not at first request.
func (c *CircuitBreaker) Provision(ctx caddy.Context) error {
	c.logger = ctx.Logger()

	if c.FailureThreshold <= 0 {
		return fmt.Errorf("rioku_circuit_breaker: failure_threshold must be > 0")
	}
	if c.TimeoutSeconds <= 0 {
		return fmt.Errorf("rioku_circuit_breaker: timeout_seconds must be > 0")
	}
	if c.SuccessThreshold <= 0 {
		c.SuccessThreshold = 1
	}
	if c.HalfOpenRequests <= 0 {
		c.HalfOpenRequests = 1
	}
	if c.BreakerName == "" {
		c.BreakerName = "default"
	}

	c.curState = stateClosed
	return nil
}

// Validate is invoked by Caddy after Provision. The Provision-time
// checks already cover the same surface, so Validate is a no-op.
func (c *CircuitBreaker) Validate() error { return nil }

// admit decides whether the current request should be forwarded to
// the upstream. It returns:
//
//   - admit=true and probe=false when the breaker is closed.
//   - admit=true and probe=true when the breaker is half-open and
//     a probe slot is available.
//   - admit=false when the breaker is open or all half-open probe
//     slots are busy. In that case the caller short-circuits with
//     a 503 + Retry-After header derived from retryAfter.
//
// admit takes the state lock, performs at most one state transition
// (open→half-open when the cooldown has elapsed), and accounts for
// the in-flight probe count for the half-open path. The caller must
// pair every (admit=true, probe=true) result with exactly one call
// to recordResult so the in-flight counter stays balanced.
func (c *CircuitBreaker) admit(now time.Time) (admit bool, probe bool, retryAfter time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	switch c.curState {
	case stateClosed:
		return true, false, 0

	case stateOpen:
		cooldown := time.Duration(c.TimeoutSeconds) * time.Second
		elapsed := now.Sub(c.openedAt)
		if elapsed < cooldown {
			return false, false, cooldown - elapsed
		}
		// Cooldown elapsed — promote to half-open and admit this
		// request as the first probe.
		c.curState = stateHalfOpen
		c.consecSuccesses = 0
		c.halfOpenInFlight = 1
		if c.logger != nil {
			c.logger.Debug("circuit breaker half-open",
				zap.String("breaker", c.BreakerName),
			)
		}
		return true, true, 0

	case stateHalfOpen:
		if c.halfOpenInFlight >= c.HalfOpenRequests {
			// All probe slots taken — reject. Use the
			// remaining cooldown when present, otherwise a
			// minimal hint.
			retry := time.Second
			cooldown := time.Duration(c.TimeoutSeconds) * time.Second
			elapsed := now.Sub(c.openedAt)
			if remaining := cooldown - elapsed; remaining > 0 {
				retry = remaining
			}
			return false, false, retry
		}
		c.halfOpenInFlight++
		return true, true, 0
	}
	return true, false, 0
}

// recordResult updates the breaker's state machine based on the
// outcome of a forwarded request. It is the second half of every
// admit→serve cycle.
func (c *CircuitBreaker) recordResult(failed bool, probe bool, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if probe {
		// Always release the half-open slot, regardless of
		// whether the state has since changed under us.
		if c.halfOpenInFlight > 0 {
			c.halfOpenInFlight--
		}
	}

	switch c.curState {
	case stateClosed:
		if failed {
			c.consecFailures++
			if c.consecFailures >= c.FailureThreshold {
				c.curState = stateOpen
				c.openedAt = now
				c.consecSuccesses = 0
				c.closedToOpenTransitions++
				if c.logger != nil {
					c.logger.Warn("circuit breaker open",
						zap.String("breaker", c.BreakerName),
						zap.Int("consecutive_failures", c.consecFailures),
					)
				}
			}
		} else {
			c.consecFailures = 0
		}

	case stateHalfOpen:
		if failed {
			// Any failure in half-open re-opens the breaker.
			c.curState = stateOpen
			c.openedAt = now
			c.consecSuccesses = 0
			c.consecFailures = c.FailureThreshold
			if c.logger != nil {
				c.logger.Warn("circuit breaker re-opened from half-open",
					zap.String("breaker", c.BreakerName),
				)
			}
			return
		}
		c.consecSuccesses++
		if c.consecSuccesses >= c.SuccessThreshold {
			c.curState = stateClosed
			c.consecFailures = 0
			c.consecSuccesses = 0
			c.halfOpenInFlight = 0
			if c.logger != nil {
				c.logger.Info("circuit breaker closed",
					zap.String("breaker", c.BreakerName),
				)
			}
		}

	case stateOpen:
		// A late result for a request started before the
		// breaker opened. Don't mutate further — the open-state
		// timer is what governs the next transition.
	}
}

// ServeHTTP applies the circuit-breaker decision. When the breaker
// admits the request, the next handler is invoked through a status-
// recording response wrapper so we can classify the outcome.
func (c *CircuitBreaker) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	now := time.Now()
	admit, probe, retryAfter := c.admit(now)
	if !admit {
		c.reject(w, retryAfter)
		return nil
	}

	rec := &responseRecorder{ResponseWriter: w}
	err := next.ServeHTTP(rec, r)
	failed := err != nil || rec.status >= 500
	c.recordResult(failed, probe, time.Now())
	return err
}

// reject writes a 503 Service Unavailable with a Retry-After header.
// The header value is rounded up to at least 1 second to keep clients
// from busy-looping when the timer is sub-second.
func (c *CircuitBreaker) reject(w http.ResponseWriter, retryAfter time.Duration) {
	secs := int(retryAfter / time.Second)
	if retryAfter%time.Second > 0 || secs < 1 {
		secs++
	}
	if secs < 1 {
		secs = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	if c.logger != nil {
		c.logger.Debug("circuit breaker rejected request",
			zap.String("breaker", c.BreakerName),
			zap.Int("retry_after_seconds", secs),
		)
	}
	w.WriteHeader(http.StatusServiceUnavailable)
}

// responseRecorder is a thin http.ResponseWriter wrapper that
// captures the status code written by the downstream chain. We use it
// instead of httptest.ResponseRecorder because we want the body and
// headers to flow straight to the real writer — only the status is
// inspected.
type responseRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

// WriteHeader captures the status code on the first call and forwards
// to the underlying writer.
func (r *responseRecorder) WriteHeader(code int) {
	if r.wroteHeader {
		// Honor stdlib semantics: subsequent calls are no-ops
		// for status capture but still forwarded so the
		// underlying writer can warn / ignore as it pleases.
		r.ResponseWriter.WriteHeader(code)
		return
	}
	r.status = code
	r.wroteHeader = true
	r.ResponseWriter.WriteHeader(code)
}

// Write captures an implicit 200 status for handlers that write a
// body without an explicit WriteHeader call.
func (r *responseRecorder) Write(b []byte) (int, error) {
	if !r.wroteHeader {
		r.status = http.StatusOK
		r.wroteHeader = true
	}
	return r.ResponseWriter.Write(b)
}

// UnmarshalCaddyfile parses a Caddyfile block:
//
//	rioku_circuit_breaker {
//	    failure_threshold 5
//	    success_threshold 1
//	    timeout_seconds 30
//	    half_open_requests 1
//	    breaker_name upstream-a
//	}
func (c *CircuitBreaker) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "failure_threshold":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &c.FailureThreshold); err != nil {
					return d.Errf("invalid failure_threshold %q: %v", v, err)
				}
			case "success_threshold":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &c.SuccessThreshold); err != nil {
					return d.Errf("invalid success_threshold %q: %v", v, err)
				}
			case "timeout_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &c.TimeoutSeconds); err != nil {
					return d.Errf("invalid timeout_seconds %q: %v", v, err)
				}
			case "half_open_requests":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &c.HalfOpenRequests); err != nil {
					return d.Errf("invalid half_open_requests %q: %v", v, err)
				}
			case "breaker_name":
				if !d.Args(&c.BreakerName) {
					return d.ArgErr()
				}
			default:
				return d.Errf("unknown rioku_circuit_breaker directive: %q", d.Val())
			}
		}
	}
	return nil
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var c CircuitBreaker
	if err := c.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &c, nil
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*CircuitBreaker)(nil)
	_ caddy.Validator             = (*CircuitBreaker)(nil)
	_ caddyhttp.MiddlewareHandler = (*CircuitBreaker)(nil)
	_ caddyfile.Unmarshaler       = (*CircuitBreaker)(nil)
)
