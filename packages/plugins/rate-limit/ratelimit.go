// Package ratelimit implements the first-party Rioku rate-limit
// Caddy module. It is the in-tree replacement for the third-party
// caddy-ratelimit plugin (per the 2026-04-06 decision and Sprint 3
// plan).
//
// v1 scope: RPM only. TPM (token-per-minute) is blocked on AI proxy
// work and lands in Sprint 5. Counters use a fixed-window algorithm
// for simplicity; sliding-window upgrade is a follow-up.
package ratelimit

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(RateLimit{})
	httpcaddyfile.RegisterHandlerDirective("rioku_ratelimit", parseCaddyfileHandler)
}

// RateLimit is a Caddy handler that enforces a request count
// limit per (scope, time-window) pair. Buckets are keyed by the
// configured scope's value extracted from each request.
//
// Scopes:
//
//   - "ip"          — bucket by the request's RemoteAddr (Caddy is
//     expected to have already populated client IP
//     via trusted_proxies).
//   - "header"      — bucket by the value of the named header
//     (HeaderName). Use this for per-API-key buckets
//     by setting HeaderName to "X-Rioku-Principal".
//   - "route_id"    — bucket by the configured RouteID. Static — every
//     request to this handler shares the same bucket.
//     Useful for "this route can do at most N rpm".
//   - "tenant_id"   — bucket by the X-Rioku-Tenant header (the
//     daemon stamps this on requests via the auth
//     pipeline).
//
// Actions:
//
//   - "block" — return 429 (default).
//   - "log"   — let the request through but emit a structured log
//     entry. Useful for observation before enforcement.
type RateLimit struct {
	// Limit is the maximum number of requests allowed in
	// WindowSeconds for any single bucket. Required.
	Limit int `json:"limit,omitempty"`

	// WindowSeconds is the rolling window length. Required.
	WindowSeconds int `json:"window_seconds,omitempty"`

	// Scope picks the bucketing strategy. Required.
	Scope string `json:"scope,omitempty"`

	// HeaderName names the header read for the "header" scope.
	// Default "X-Rioku-Principal" (matches the auth modules).
	HeaderName string `json:"header_name,omitempty"`

	// RouteID is the static value used by the "route_id" scope.
	// Required when Scope == "route_id".
	RouteID string `json:"route_id,omitempty"`

	// Action is the enforcement decision when a bucket is over
	// limit. Default "block".
	Action string `json:"action,omitempty"`

	// Storage selects the counter backend. v1 only "mem" is wired;
	// "redis" returns an explicit error at Provision so callers
	// learn at config time. Default "mem".
	Storage string `json:"storage,omitempty"`

	// QuotaWebhookEndpoint is the daemon-side URL the module POSTs
	// to on the FIRST block of every (api_key_hash, plan_id, day)
	// bucket so the daemon can fan out
	// `subscription.exceeded_quota` (#202). Empty disables. The
	// daemon dedupes on its end too; this client-side dedupe just
	// keeps the wire chatter low under sustained breaches.
	QuotaWebhookEndpoint string `json:"quota_webhook_endpoint,omitempty"`

	// Computed at Provision.
	store          CounterStore
	logger         *zap.Logger
	quotaClient    *http.Client
	quotaSeenMu    sync.Mutex
	quotaSeenTimes map[string]time.Time
}

// CaddyModule registers the handler under
// http.handlers.rioku_ratelimit.
func (RateLimit) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_ratelimit",
		New: func() caddy.Module { return new(RateLimit) },
	}
}

// Provision sets default values and constructs the counter store.
func (r *RateLimit) Provision(ctx caddy.Context) error {
	r.logger = ctx.Logger()

	if r.Limit <= 0 {
		return fmt.Errorf("rioku_ratelimit: limit must be > 0")
	}
	if r.WindowSeconds <= 0 {
		return fmt.Errorf("rioku_ratelimit: window_seconds must be > 0")
	}
	switch r.Scope {
	case "ip", "header", "route_id", "tenant_id":
	case "":
		return fmt.Errorf("rioku_ratelimit: scope is required (ip|header|route_id|tenant_id)")
	default:
		return fmt.Errorf("rioku_ratelimit: unknown scope %q", r.Scope)
	}
	if r.Scope == "header" && r.HeaderName == "" {
		r.HeaderName = "X-Rioku-Principal"
	}
	if r.Scope == "route_id" && r.RouteID == "" {
		return fmt.Errorf("rioku_ratelimit: route_id scope requires route_id to be set")
	}
	if r.Action == "" {
		r.Action = "block"
	}
	if r.Action != "block" && r.Action != "log" {
		return fmt.Errorf("rioku_ratelimit: unknown action %q (valid: block, log)", r.Action)
	}
	if r.Storage == "" {
		r.Storage = "mem"
	}
	switch r.Storage {
	case "mem":
		r.store = NewMemoryStore()
	case "redis":
		return fmt.Errorf("rioku_ratelimit: redis storage not implemented in v1; use mem")
	default:
		return fmt.Errorf("rioku_ratelimit: unknown storage %q (valid: mem, redis)", r.Storage)
	}
	if r.QuotaWebhookEndpoint != "" {
		r.quotaClient = &http.Client{Timeout: 2 * time.Second}
		r.quotaSeenTimes = map[string]time.Time{}
	}

	return nil
}

func (r *RateLimit) Validate() error { return nil }

// ServeHTTP applies the rate-limit decision.
func (r *RateLimit) ServeHTTP(w http.ResponseWriter, req *http.Request, next caddyhttp.Handler) error {
	bucket := r.bucketKey(req)
	if bucket == "" {
		// Empty bucket -> no key to count against (e.g., header
		// scope on an unauthenticated request). Fail open: let
		// the request through. Operators that want strict
		// behaviour should chain rioku_apikey/rioku_jwt before
		// this handler.
		return next.ServeHTTP(w, req)
	}

	// Sprint 4 Phase 1c (#164) — rioku_apikey resolves the API key
	// chain Key -> Subscription -> Plan and stamps Plan-level RPM
	// on X-Rioku-Plan-RPM. Use the lower of (configured Limit,
	// Plan RPM): a route-level cap should never raise above the
	// Plan-level cap, and a Plan-level cap should never raise
	// above the route-level operator cap.
	effectiveLimit := r.Limit
	if planRPM := planRPMFromHeader(req); planRPM > 0 && planRPM < effectiveLimit {
		effectiveLimit = planRPM
	}

	window := time.Duration(r.WindowSeconds) * time.Second
	count, resetUnix := r.store.Increment(bucket, window)

	remaining := effectiveLimit - count
	if remaining < 0 {
		remaining = 0
	}
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(effectiveLimit))
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetUnix, 10))

	if count > effectiveLimit {
		if r.Action == "block" {
			retryAfter := resetUnix - time.Now().Unix()
			if retryAfter < 1 {
				retryAfter = 1
			}
			w.Header().Set("Retry-After", strconv.FormatInt(retryAfter, 10))
			if r.logger != nil {
				r.logger.Debug("rate limit blocked",
					zap.String("bucket", bucket),
					zap.Int("count", count),
					zap.Int("limit", effectiveLimit),
				)
			}
			r.fireQuotaWebhook(req, count, effectiveLimit)
			w.WriteHeader(http.StatusTooManyRequests)
			return nil
		}
		// Action == "log": fall through after emitting the
		// signal so operators can observe the breach without
		// enforcing it.
		if r.logger != nil {
			r.logger.Info("rate limit threshold exceeded (action=log)",
				zap.String("bucket", bucket),
				zap.Int("count", count),
				zap.Int("limit", effectiveLimit),
			)
		}
	}

	return next.ServeHTTP(w, req)
}

// bucketKey returns the per-request bucket key. Empty when the scope
// can't be resolved (e.g., header scope with no value) — caller
// fails open in that case.
func (r *RateLimit) bucketKey(req *http.Request) string {
	switch r.Scope {
	case "ip":
		host, _, err := net.SplitHostPort(req.RemoteAddr)
		if err != nil {
			host = req.RemoteAddr
		}
		return "ip:" + host
	case "header":
		v := strings.TrimSpace(req.Header.Get(r.HeaderName))
		if v == "" {
			return ""
		}
		return "h:" + r.HeaderName + ":" + v
	case "route_id":
		return "r:" + r.RouteID
	case "tenant_id":
		v := strings.TrimSpace(req.Header.Get("X-Rioku-Tenant"))
		if v == "" {
			return ""
		}
		return "t:" + v
	}
	return ""
}

// UnmarshalCaddyfile parses a Caddyfile block:
//
//	rioku_ratelimit {
//	    limit 100
//	    window_seconds 60
//	    scope header
//	    header_name X-Rioku-Principal
//	    action block
//	    storage mem
//	}
func (r *RateLimit) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "limit":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &r.Limit); err != nil {
					return d.Errf("invalid limit %q: %v", v, err)
				}
			case "window_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &r.WindowSeconds); err != nil {
					return d.Errf("invalid window_seconds %q: %v", v, err)
				}
			case "scope":
				if !d.Args(&r.Scope) {
					return d.ArgErr()
				}
			case "header_name":
				if !d.Args(&r.HeaderName) {
					return d.ArgErr()
				}
			case "route_id":
				if !d.Args(&r.RouteID) {
					return d.ArgErr()
				}
			case "action":
				if !d.Args(&r.Action) {
					return d.ArgErr()
				}
			case "storage":
				if !d.Args(&r.Storage) {
					return d.ArgErr()
				}
			default:
				return d.Errf("unknown rioku_ratelimit directive: %q", d.Val())
			}
		}
	}
	return nil
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var r RateLimit
	if err := r.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &r, nil
}

// CounterStore abstracts the counter backend so the same handler can
// switch between in-memory and Redis-backed counters per D11. v1
// only ships the memory backend.
type CounterStore interface {
	// Increment bumps the bucket's counter and returns the new
	// count + the unix-second timestamp at which the current
	// window resets. Implementations must zero the counter when
	// the active window has elapsed.
	Increment(bucket string, window time.Duration) (count int, resetUnix int64)
}

// MemoryStore is the default in-process counter implementation.
// Buckets reset at fixed window boundaries computed from the
// monotonic clock. Per D11 the persistence layer is the SQLite
// flush — wiring the flush is a daemon-side concern (out of scope
// for this Caddy plugin module).
//
// Algorithm: for each bucket we keep the start time of the active
// window and the count. When Increment finds the current window has
// expired, the counter resets to 1 and the window slides forward.
type MemoryStore struct {
	buckets sync.Map // bucket -> *bucketState
}

type bucketState struct {
	mu          sync.Mutex
	count       atomic.Int64
	windowStart int64 // unix seconds
}

// NewMemoryStore builds an empty MemoryStore.
func NewMemoryStore() *MemoryStore { return &MemoryStore{} }

// Increment bumps the named bucket. Reset semantics: the window
// starts at the unix-second timestamp of the first Increment for
// that bucket; when WindowSeconds elapses, the next Increment slides
// the window forward to start at the current time.
func (m *MemoryStore) Increment(bucket string, window time.Duration) (int, int64) {
	now := time.Now().Unix()
	winSecs := int64(window / time.Second)
	if winSecs < 1 {
		winSecs = 1
	}

	loaded, _ := m.buckets.LoadOrStore(bucket, &bucketState{windowStart: now})
	st := loaded.(*bucketState)

	st.mu.Lock()
	if now-st.windowStart >= winSecs {
		// Window elapsed; reset.
		st.windowStart = now
		st.count.Store(0)
	}
	st.mu.Unlock()

	newCount := st.count.Add(1)
	return int(newCount), st.windowStart + winSecs
}

// Reset clears the bucket. Test helper; not part of the
// CounterStore interface. Production use is "wait for the window".
func (m *MemoryStore) Reset(bucket string) {
	m.buckets.Delete(bucket)
}

// planRPMFromHeader reads the X-Rioku-Plan-RPM header that
// rioku_apikey stamps when the API key resolves to a Plan with a
// non-zero RateLimitPerMinute (Sprint 4 Phase 1c #164). Returns 0
// when the header is absent or unparseable.
func planRPMFromHeader(req *http.Request) int {
	v := req.Header.Get("X-Rioku-Plan-RPM")
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// quotaDedupTTL is how long the plugin's local cache suppresses
// repeat quota webhooks for the same (key, plan, day) bucket. The
// daemon dedupes too, but local suppression keeps the wire chatter
// low under sustained breaches.
const quotaDedupTTL = 24 * time.Hour

// fireQuotaWebhook POSTs a `subscription.exceeded_quota` event to
// the daemon's keyvalidator endpoint (#202). Best-effort: failures
// are logged but never affect the response. Only fires when the
// inbound request carried a Plan binding (X-Rioku-Plan + the
// hashed key in X-Rioku-API-Key-Hash from the apikey plugin); other
// blocks (IP scope, JWT, no-Plan keys) are out of scope.
func (r *RateLimit) fireQuotaWebhook(req *http.Request, count, limit int) {
	if r.quotaClient == nil || r.QuotaWebhookEndpoint == "" {
		return
	}
	planID := strings.TrimSpace(req.Header.Get("X-Rioku-Plan"))
	keyHash := strings.TrimSpace(req.Header.Get("X-Rioku-API-Key-Hash"))
	tenantID := strings.TrimSpace(req.Header.Get("X-Rioku-Tenant-Id"))
	if planID == "" || keyHash == "" {
		return
	}

	now := time.Now().UTC()
	day := now.Format("2006-01-02")
	dedupKey := keyHash + "|" + planID + "|" + day
	r.quotaSeenMu.Lock()
	last, seen := r.quotaSeenTimes[dedupKey]
	if seen && now.Sub(last) < quotaDedupTTL {
		r.quotaSeenMu.Unlock()
		return
	}
	r.quotaSeenTimes[dedupKey] = now
	for k, t := range r.quotaSeenTimes {
		if now.Sub(t) >= quotaDedupTTL {
			delete(r.quotaSeenTimes, k)
		}
	}
	r.quotaSeenMu.Unlock()

	body, err := json.Marshal(map[string]any{
		"api_key_hash": keyHash,
		"plan_id":      planID,
		"tenant_id":    tenantID,
		"limit":        limit,
		"count":        count,
	})
	if err != nil {
		return
	}
	go func() {
		hreq, herr := http.NewRequest(http.MethodPost, r.QuotaWebhookEndpoint, bytes.NewReader(body))
		if herr != nil {
			return
		}
		hreq.Header.Set("Content-Type", "application/json")
		resp, herr := r.quotaClient.Do(hreq)
		if herr != nil {
			if r.logger != nil {
				r.logger.Debug("quota webhook unreachable", zap.Error(herr))
			}
			return
		}
		_ = resp.Body.Close()
	}()
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*RateLimit)(nil)
	_ caddy.Validator             = (*RateLimit)(nil)
	_ caddyhttp.MiddlewareHandler = (*RateLimit)(nil)
	_ caddyfile.Unmarshaler       = (*RateLimit)(nil)
)
