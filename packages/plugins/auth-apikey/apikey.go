package authapikey

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(APIKey{})
	httpcaddyfile.RegisterHandlerDirective("rioku_apikey", parseCaddyfileHandler)
}

// APIKey authenticates downstream requests by looking up an opaque
// API key against the daemon. The daemon is the source of truth: the
// plugin sends the key over a loopback HTTP validation endpoint
// (typically the daemon's internal address) and receives a principal +
// scope list, or a structured rejection.
//
// v1 standalone-mode behaviour: the validation endpoint resolves
// scope strings of the form "keys:<name>" directly. Once Subscription
// + Plan land in Sprint 4, the same endpoint will resolve the
// Subscription -> Plan -> security_type chain — the plugin is
// agnostic to which side of that gate the daemon is on.
//
// Lookup precedence (first non-empty wins):
//
//  1. Header named by Header (default "Authorization", with optional
//     "Bearer " or "Token " prefix stripped).
//  2. Basic-auth username with a fixed value (BasicAuthUsername set,
//     password is the API key). Matches the AWS / Stripe pattern.
//  3. Query parameter named by QueryParam.
//
// DisallowedLocations gates which lookup path may carry the key —
// for example, a production config typically sets ["query"] to
// reject any key in the URL.
type APIKey struct {
	// Header is the request header that carries the key. Empty
	// disables header lookup. Default "Authorization".
	Header string `json:"header,omitempty"`

	// BasicAuthUsername, when non-empty, treats the request's
	// HTTP Basic auth username as the key when the value matches
	// this string (e.g., "api"). The password segment is the key.
	BasicAuthUsername string `json:"basic_auth_username,omitempty"`

	// QueryParam is the URL query parameter to read the key from.
	// Empty disables query-param lookup.
	QueryParam string `json:"query_param,omitempty"`

	// DisallowedLocations forbids lookup paths even if they are
	// otherwise configured. Valid entries: "header", "basic_auth",
	// "query". Use ["query"] to reject keys in URLs in production.
	DisallowedLocations []string `json:"disallowed_locations,omitempty"`

	// CacheTTLSeconds controls the LRU lookup cache. Default 60s;
	// zero disables caching. Negative is clamped to 0.
	CacheTTLSeconds int `json:"cache_ttl_seconds,omitempty"`

	// CacheSize caps the LRU cache. Default 4096.
	CacheSize int `json:"cache_size,omitempty"`

	// ValidationEndpoint is the URL the plugin POSTs each key to
	// for daemon-side validation. Body: {"key_hash": "<sha256-hex>"}.
	// Response: {"valid": bool, "principal": "...", "scopes": [...],
	// "reason": "missing|expired|revoked|invalid"}.
	//
	// The plugin sends the SHA-256 hash of the key, never the raw
	// key, so the validation endpoint never sees plaintext on the
	// wire (the daemon stores hashes anyway). Per D12 the
	// validation flow stays inside the trust boundary.
	ValidationEndpoint string `json:"validation_endpoint,omitempty"`

	// RequestTimeoutSeconds caps each validation HTTP call. Default
	// 5s.
	RequestTimeoutSeconds int `json:"request_timeout_seconds,omitempty"`

	// Computed at Provision.
	disallow  map[string]struct{}
	cache     *lookupCache
	validator validator
	logger    *zap.Logger
}

// CaddyModule registers this handler under
// http.handlers.rioku_apikey.
func (APIKey) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_apikey",
		New: func() caddy.Module { return new(APIKey) },
	}
}

func (a *APIKey) Provision(ctx caddy.Context) error {
	a.logger = ctx.Logger()

	if a.Header == "" && a.QueryParam == "" && a.BasicAuthUsername == "" {
		return fmt.Errorf("rioku_apikey: at least one of header / basic_auth_username / query_param must be set")
	}
	if a.ValidationEndpoint == "" {
		return fmt.Errorf("rioku_apikey: validation_endpoint is required")
	}
	if a.Header == "" && (a.QueryParam != "" || a.BasicAuthUsername != "") {
		// header is the default lookup path; only require it
		// implicitly when nothing else is configured. With a
		// non-default config we leave the header path off.
	} else if a.Header == "" {
		a.Header = "Authorization"
	}

	a.disallow = make(map[string]struct{}, len(a.DisallowedLocations))
	for _, loc := range a.DisallowedLocations {
		switch loc {
		case "header", "basic_auth", "query":
			a.disallow[loc] = struct{}{}
		default:
			return fmt.Errorf("rioku_apikey: unknown disallowed_location %q (valid: header, basic_auth, query)", loc)
		}
	}

	if a.RequestTimeoutSeconds <= 0 {
		a.RequestTimeoutSeconds = 5
	}
	if a.CacheTTLSeconds < 0 {
		a.CacheTTLSeconds = 0
	}
	if a.CacheTTLSeconds == 0 {
		a.CacheTTLSeconds = 60
	}
	if a.CacheSize <= 0 {
		a.CacheSize = 4096
	}
	a.cache = newLookupCache(a.CacheSize, time.Duration(a.CacheTTLSeconds)*time.Second)

	if a.validator == nil {
		a.validator = &httpValidator{
			endpoint: a.ValidationEndpoint,
			client: &http.Client{
				Timeout: time.Duration(a.RequestTimeoutSeconds) * time.Second,
			},
		}
	}

	return nil
}

func (a *APIKey) Validate() error { return nil }

// ServeHTTP authenticates the inbound request. Cache-hit paths return
// in ~constant time; cache-miss paths block on the validator.
//
// Status code mapping:
//
//	missing  -> 401 (no key provided / disallowed location)
//	invalid  -> 401 (key not recognized)
//	expired  -> 401
//	revoked  -> 403 (key was once valid, deliberately removed)
//	internal -> 502 (validation endpoint unreachable)
func (a *APIKey) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	key, source, found := a.extractKey(r)
	if !found {
		return a.deny(w, http.StatusUnauthorized, "missing", "no key in any allowed location")
	}
	if _, blocked := a.disallow[source]; blocked {
		return a.deny(w, http.StatusUnauthorized, "missing",
			fmt.Sprintf("location %q is disallowed by config", source))
	}

	keyHash := sha256Hex(key)

	if entry, ok := a.cache.get(keyHash); ok {
		return a.applyResult(w, r, next, entry)
	}

	res, err := a.validator.Validate(r.Context(), keyHash)
	if err != nil {
		// Don't cache validation failures — surfaces a transient
		// outage as 502 without poisoning the cache.
		if a.logger != nil {
			a.logger.Warn("api key validation endpoint failed", zap.Error(err))
		}
		w.WriteHeader(http.StatusBadGateway)
		return nil
	}
	a.cache.put(keyHash, res)
	return a.applyResult(w, r, next, res)
}

func (a *APIKey) applyResult(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler, res ValidationResult) error {
	if !res.Valid {
		switch res.Reason {
		case "revoked":
			return a.deny(w, http.StatusForbidden, "revoked", "key revoked")
		case "expired":
			return a.deny(w, http.StatusUnauthorized, "expired", "key expired")
		case "missing":
			return a.deny(w, http.StatusUnauthorized, "missing", "key unknown")
		default:
			return a.deny(w, http.StatusUnauthorized, "invalid", "key invalid")
		}
	}
	if res.Principal != "" {
		r.Header.Set("X-Rioku-Principal", res.Principal)
		if repl, ok := r.Context().Value(caddy.ReplacerCtxKey).(*caddy.Replacer); ok && repl != nil {
			repl.Set("http.auth.user.id", res.Principal)
		}
	}
	if len(res.Scopes) > 0 {
		r.Header.Set("X-Rioku-Scopes", strings.Join(res.Scopes, ","))
	}
	// Sprint 4 Phase 1c — surface the resolved Plan chain so the
	// downstream rate-limit / quota handlers can apply Plan-level
	// caps without re-resolving. Only the rioku_ratelimit module
	// reads these headers today; the contract is documented so
	// other handlers can consume them too.
	if res.PlanID != "" {
		r.Header.Set("X-Rioku-Plan", res.PlanID)
		if repl, ok := r.Context().Value(caddy.ReplacerCtxKey).(*caddy.Replacer); ok && repl != nil {
			repl.Set("http.auth.plan.id", res.PlanID)
		}
	}
	if res.RateLimitPerMinute > 0 {
		r.Header.Set("X-Rioku-Plan-RPM", strconv.Itoa(res.RateLimitPerMinute))
	}
	if res.QuotaPerDay > 0 {
		r.Header.Set("X-Rioku-Plan-Quota-Per-Day", strconv.Itoa(res.QuotaPerDay))
	}
	return next.ServeHTTP(w, r)
}

// extractKey returns (key, source, ok). source is one of
// "header", "basic_auth", "query".
func (a *APIKey) extractKey(r *http.Request) (string, string, bool) {
	if a.Header != "" {
		if v := r.Header.Get(a.Header); v != "" {
			v = strings.TrimSpace(v)
			for _, prefix := range []string{"Bearer ", "Token "} {
				if strings.HasPrefix(v, prefix) {
					v = strings.TrimPrefix(v, prefix)
					break
				}
			}
			return v, "header", true
		}
	}
	if a.BasicAuthUsername != "" {
		if user, pass, ok := r.BasicAuth(); ok && user == a.BasicAuthUsername && pass != "" {
			return pass, "basic_auth", true
		}
	}
	if a.QueryParam != "" {
		if v := r.URL.Query().Get(a.QueryParam); v != "" {
			return v, "query", true
		}
	}
	return "", "", false
}

func (a *APIKey) deny(w http.ResponseWriter, code int, reason, debug string) error {
	if a.logger != nil {
		a.logger.Debug("api key denied",
			zap.String("reason", reason),
			zap.String("debug", debug),
			zap.Int("status", code),
		)
	}
	w.Header().Set("WWW-Authenticate", `Rioku realm="api"`)
	w.WriteHeader(code)
	return nil
}

// sha256Hex is the canonical hash function for API keys. Matches
// what the daemon stores in api_keys.key_hash.
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// UnmarshalCaddyfile parses a Caddyfile block:
//
//	rioku_apikey {
//	    header Authorization
//	    basic_auth_username api
//	    query_param api_key
//	    disallowed_locations query
//	    cache_ttl_seconds 60
//	    cache_size 4096
//	    validation_endpoint http://127.0.0.1:7790/internal/auth/validate-key
//	    request_timeout_seconds 5
//	}
func (a *APIKey) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "header":
				if !d.Args(&a.Header) {
					return d.ArgErr()
				}
			case "basic_auth_username":
				if !d.Args(&a.BasicAuthUsername) {
					return d.ArgErr()
				}
			case "query_param":
				if !d.Args(&a.QueryParam) {
					return d.ArgErr()
				}
			case "disallowed_locations":
				a.DisallowedLocations = append(a.DisallowedLocations, d.RemainingArgs()...)
			case "cache_ttl_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &a.CacheTTLSeconds); err != nil {
					return d.Errf("invalid cache_ttl_seconds %q: %v", v, err)
				}
			case "cache_size":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &a.CacheSize); err != nil {
					return d.Errf("invalid cache_size %q: %v", v, err)
				}
			case "validation_endpoint":
				if !d.Args(&a.ValidationEndpoint) {
					return d.ArgErr()
				}
			case "request_timeout_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &a.RequestTimeoutSeconds); err != nil {
					return d.Errf("invalid request_timeout_seconds %q: %v", v, err)
				}
			default:
				return d.Errf("unknown rioku_apikey directive: %q", d.Val())
			}
		}
	}
	return nil
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var a APIKey
	if err := a.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &a, nil
}

// ---------- LRU cache ----------

type cacheEntry struct {
	res     ValidationResult
	expires time.Time
}

type lookupCache struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
	max     int
	ttl     time.Duration
}

func newLookupCache(max int, ttl time.Duration) *lookupCache {
	return &lookupCache{
		entries: make(map[string]cacheEntry, max),
		max:     max,
		ttl:     ttl,
	}
}

func (c *lookupCache) get(key string) (ValidationResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok {
		return ValidationResult{}, false
	}
	if time.Now().After(e.expires) {
		delete(c.entries, key)
		return ValidationResult{}, false
	}
	return e.res, true
}

func (c *lookupCache) put(key string, res ValidationResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Hard cap with simple eviction: when full, drop one
	// arbitrary entry. Map iteration order is randomized, which
	// is good enough for an in-process LRU at this scale; the
	// rate-limit module's counter store gets a real W-TinyLFU.
	if len(c.entries) >= c.max {
		for k := range c.entries {
			delete(c.entries, k)
			break
		}
	}
	c.entries[key] = cacheEntry{
		res:     res,
		expires: time.Now().Add(c.ttl),
	}
}

// ---------- Validator ----------

// ValidationResult is the shape the validation endpoint returns and
// the plugin caches. Valid=false carries Reason for status-code
// mapping (revoked -> 403, others -> 401).
//
// Sprint 4 Phase 1c (#164) extended the response with the resolved
// chain — when the API key is bound to a Subscription, the validator
// surfaces the parent Plan's PlanID + RateLimitPerMinute + QuotaPerDay
// so the plugin can stamp them on the request for downstream
// rate-limit / quota handlers without those handlers having to
// re-resolve the key chain.
type ValidationResult struct {
	Valid     bool     `json:"valid"`
	Principal string   `json:"principal,omitempty"`
	Scopes    []string `json:"scopes,omitempty"`
	Reason    string   `json:"reason,omitempty"` // missing | expired | revoked | invalid

	// PlanID is the Plan resolved through the API key's
	// Subscription. Empty when the key is not bound to a Plan.
	PlanID string `json:"plan_id,omitempty"`

	// RateLimitPerMinute is the Plan-level RPM cap surfaced for the
	// downstream rioku_ratelimit module. 0 means no Plan-level cap.
	RateLimitPerMinute int `json:"rate_limit_per_minute,omitempty"`

	// QuotaPerDay is the Plan-level daily request quota. 0 means
	// no Plan-level quota.
	QuotaPerDay int `json:"quota_per_day,omitempty"`
}

type validator interface {
	Validate(ctx interface{ Done() <-chan struct{} }, keyHash string) (ValidationResult, error)
}

// httpValidator POSTs the key hash to the configured endpoint.
type httpValidator struct {
	endpoint string
	client   *http.Client
}

func (h *httpValidator) Validate(ctx interface{ Done() <-chan struct{} }, keyHash string) (ValidationResult, error) {
	body, err := json.Marshal(map[string]string{"key_hash": keyHash})
	if err != nil {
		return ValidationResult{}, fmt.Errorf("marshal validation request: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, h.endpoint, strings.NewReader(string(body)))
	if err != nil {
		return ValidationResult{}, fmt.Errorf("build validation request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		return ValidationResult{}, fmt.Errorf("validation endpoint unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return ValidationResult{}, fmt.Errorf("validation endpoint returned %d", resp.StatusCode)
	}
	var out ValidationResult
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return ValidationResult{}, fmt.Errorf("decode validation response: %w", err)
	}
	return out, nil
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*APIKey)(nil)
	_ caddy.Validator             = (*APIKey)(nil)
	_ caddyhttp.MiddlewareHandler = (*APIKey)(nil)
	_ caddyfile.Unmarshaler       = (*APIKey)(nil)
)
