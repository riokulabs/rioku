package mirror

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(Mirror{})
	httpcaddyfile.RegisterHandlerDirective("rioku_mirror", parseCaddyfileHandler)
}

// Default configuration values applied at Provision when the user
// leaves the corresponding field at the zero value.
const (
	defaultSampleRate     = 1.0
	defaultTimeoutSeconds = 5
	defaultMaxBodyBytes   = int64(1 << 20) // 1 MiB
)

// hopByHopHeaders are stripped from mirrored requests because they
// describe a single transport hop and are meaningless when replayed
// against a different upstream. RFC 7230 §6.1.
var hopByHopHeaders = []string{
	"Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"Proxy-Connection",
	"Te",
	"Trailer",
	"Transfer-Encoding",
	"Upgrade",
}

// Mirror duplicates a sample of inbound requests to a secondary
// upstream while always passing the original to the primary handler.
// The mirrored request is fire-and-forget — its response is read and
// discarded. Mirror failures never affect the primary path.
type Mirror struct {
	// MirrorURL is the absolute URL of the secondary upstream. The
	// inbound request's path and query string are appended to this
	// URL, so a typical value is "http://shadow.internal:8080".
	// Required.
	MirrorURL string `json:"mirror_url,omitempty"`

	// SampleRate is the fraction of requests to mirror, in [0.0, 1.0].
	// 0.0 disables mirroring entirely. 1.0 mirrors every request.
	// Defaults to 1.0 when unset.
	SampleRate float64 `json:"sample_rate,omitempty"`

	// TimeoutSeconds caps the lifetime of each mirror request.
	// Mirrored requests are fire-and-forget so a slow mirror upstream
	// would otherwise leak goroutines. Defaults to 5s when zero.
	TimeoutSeconds int `json:"timeout_seconds,omitempty"`

	// MaxBodyBytes refuses to mirror requests whose body exceeds this
	// size — buffering an unbounded body to fan out a duplicate would
	// double memory pressure on the gateway. Defaults to 1 MiB.
	// Negative disables the limit (not recommended).
	MaxBodyBytes int64 `json:"max_body_bytes,omitempty"`

	// Computed at Provision.
	logger     *zap.Logger
	client     *http.Client
	sampler    *sampler
	timeoutDur time.Duration
}

// sampler bundles the RNG and its mutex behind a pointer so the
// outer Mirror struct can be copied by value (Caddy registers modules
// by value and `go vet` flags embedded mutexes).
type sampler struct {
	mu  sync.Mutex
	rng *rand.Rand
}

func (s *sampler) float64() float64 {
	s.mu.Lock()
	v := s.rng.Float64()
	s.mu.Unlock()
	return v
}

// CaddyModule registers this handler under the
// http.handlers.rioku_mirror namespace.
func (Mirror) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_mirror",
		New: func() caddy.Module { return new(Mirror) },
	}
}

// Provision normalises defaults, validates configuration and prepares
// the HTTP client + RNG used by ServeHTTP.
func (m *Mirror) Provision(ctx caddy.Context) error {
	m.logger = ctx.Logger()

	if m.MirrorURL == "" {
		return fmt.Errorf("rioku_mirror: mirror_url is required")
	}

	if m.SampleRate == 0 {
		// Distinguish "left blank" from "explicitly 0.0" using JSON
		// presence is impossible from a plain struct, so we adopt the
		// convention that zero means default — operators who want to
		// disable mirroring should remove the directive.
		m.SampleRate = defaultSampleRate
	}
	if m.SampleRate < 0 || m.SampleRate > 1 {
		return fmt.Errorf("rioku_mirror: sample_rate must be in [0,1], got %v", m.SampleRate)
	}

	if m.TimeoutSeconds == 0 {
		m.TimeoutSeconds = defaultTimeoutSeconds
	}
	if m.TimeoutSeconds < 0 {
		return fmt.Errorf("rioku_mirror: timeout_seconds must be >= 0, got %d", m.TimeoutSeconds)
	}
	m.timeoutDur = time.Duration(m.TimeoutSeconds) * time.Second

	if m.MaxBodyBytes == 0 {
		m.MaxBodyBytes = defaultMaxBodyBytes
	}

	// Seed the RNG once at Provision. Per-request locking keeps the
	// generator goroutine-safe for concurrent ServeHTTP calls.
	m.sampler = &sampler{rng: rand.New(rand.NewSource(time.Now().UnixNano()))}

	m.client = &http.Client{
		Timeout: m.timeoutDur,
	}

	return nil
}

// Validate is invoked by Caddy after Provision. The Provision-time
// checks already cover the configuration surface, so Validate is a
// no-op for now.
func (m *Mirror) Validate() error { return nil }

// ServeHTTP applies the sample rate, optionally buffers the body and
// dispatches the duplicate request, and always forwards the original
// to the next handler.
func (m *Mirror) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	if m.shouldMirror() {
		m.dispatchMirror(r)
	}
	return next.ServeHTTP(w, r)
}

// shouldMirror returns true when the request falls within the sample
// window. SampleRate=1.0 short-circuits the RNG entirely.
func (m *Mirror) shouldMirror() bool {
	if m.SampleRate <= 0 {
		return false
	}
	if m.SampleRate >= 1 {
		return true
	}
	return m.sampler.float64() < m.SampleRate
}

// dispatchMirror buffers the body (if any), then fires a clone of the
// request at MirrorURL in a background goroutine. The original
// r.Body is replaced with a fresh reader so the primary handler still
// sees the full payload.
func (m *Mirror) dispatchMirror(r *http.Request) {
	body, ok := m.bufferBody(r)
	if !ok {
		return
	}

	// Capture the mirror destination + a copy of relevant request
	// fields *before* the goroutine runs — the original request may
	// be mutated or completed by the primary handler in parallel.
	target := m.MirrorURL + r.URL.RequestURI()
	method := r.Method
	headers := cloneHeader(r.Header)
	stripHopByHopHeaders(headers)

	go m.send(method, target, headers, body)
}

// bufferBody reads the request body up to MaxBodyBytes and replaces
// r.Body with a fresh reader so the primary handler can still read
// the payload. Returns ok=false when the body is too large or cannot
// be read — in either case the caller should skip mirroring.
func (m *Mirror) bufferBody(r *http.Request) ([]byte, bool) {
	if r.Body == nil || r.Body == http.NoBody {
		return nil, true
	}

	limit := m.MaxBodyBytes
	if limit < 0 {
		// Caller opted out of the cap. We still bound reads at a
		// large but finite ceiling to keep the goroutine accountable.
		limit = int64(1 << 30) // 1 GiB
	}

	// Read one byte past the limit to detect oversize bodies cheaply.
	lr := io.LimitReader(r.Body, limit+1)
	buf, err := io.ReadAll(lr)
	if err != nil {
		if m.logger != nil {
			m.logger.Debug("mirror: read body failed", zap.Error(err))
		}
		// Best effort: rebuild r.Body from what we managed to read so
		// the primary path still has *some* payload. Returning
		// ok=false suppresses the mirror.
		r.Body = io.NopCloser(bytes.NewReader(buf))
		return nil, false
	}

	if int64(len(buf)) > limit {
		if m.logger != nil {
			m.logger.Debug("mirror: body exceeds max_body_bytes, skipping",
				zap.Int64("max_body_bytes", limit),
				zap.Int("read_bytes", len(buf)),
			)
		}
		// Drain the remainder into the buffer so the primary handler
		// still sees the entire body. The mirror is skipped.
		rest, drainErr := io.ReadAll(r.Body)
		if drainErr != nil && m.logger != nil {
			m.logger.Debug("mirror: drain remainder failed", zap.Error(drainErr))
		}
		buf = append(buf, rest...)
		r.Body = io.NopCloser(bytes.NewReader(buf))
		return nil, false
	}

	r.Body = io.NopCloser(bytes.NewReader(buf))
	return buf, true
}

// send executes the mirrored request and discards the response.
// Errors are logged at debug level — mirror failures must never
// surface to the client.
func (m *Mirror) send(method, target string, headers http.Header, body []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), m.timeoutDur)
	defer cancel()

	var bodyReader io.Reader
	if len(body) > 0 {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, target, bodyReader)
	if err != nil {
		if m.logger != nil {
			m.logger.Debug("mirror: build request failed", zap.Error(err))
		}
		return
	}
	req.Header = headers
	if len(body) > 0 {
		req.ContentLength = int64(len(body))
	}

	resp, err := m.client.Do(req)
	if err != nil {
		if m.logger != nil {
			m.logger.Debug("mirror: dispatch failed",
				zap.String("target", target),
				zap.Error(err),
			)
		}
		return
	}
	// Drain + close so the underlying connection can be reused.
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
}

// cloneHeader returns a deep copy of h. The mirror request must not
// share header maps with the primary request — the primary handler
// may mutate the original headers concurrently.
func cloneHeader(h http.Header) http.Header {
	out := make(http.Header, len(h))
	for k, v := range h {
		copied := make([]string, len(v))
		copy(copied, v)
		out[k] = copied
	}
	return out
}

// stripHopByHopHeaders removes headers that describe a single
// transport hop and have no meaning when replayed at a different
// upstream. Connection-listed headers are also removed (RFC 7230).
func stripHopByHopHeaders(h http.Header) {
	if conn := h.Get("Connection"); conn != "" {
		// "Connection: close, foo" — every token names another
		// header to strip. Defer to the canonical helper below.
		for _, name := range splitConnectionTokens(conn) {
			h.Del(name)
		}
	}
	for _, name := range hopByHopHeaders {
		h.Del(name)
	}
}

// splitConnectionTokens splits a Connection header value on commas
// and trims whitespace, returning the canonical names.
func splitConnectionTokens(v string) []string {
	out := make([]string, 0, 2)
	start := 0
	for i := 0; i <= len(v); i++ {
		if i == len(v) || v[i] == ',' {
			tok := trimSpace(v[start:i])
			if tok != "" {
				out = append(out, tok)
			}
			start = i + 1
		}
	}
	return out
}

// trimSpace removes leading/trailing ASCII whitespace without pulling
// in the strings package — this hot-path runs per mirrored request.
func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

// UnmarshalCaddyfile parses a Caddyfile block:
//
//	rioku_mirror {
//	    mirror_url http://shadow.internal:8080
//	    sample_rate 0.1
//	    timeout_seconds 5
//	    max_body_bytes 1048576
//	}
func (m *Mirror) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "mirror_url":
				if !d.Args(&m.MirrorURL) {
					return d.ArgErr()
				}
			case "sample_rate":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%f", &m.SampleRate); err != nil {
					return d.Errf("invalid sample_rate %q: %v", v, err)
				}
			case "timeout_seconds":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &m.TimeoutSeconds); err != nil {
					return d.Errf("invalid timeout_seconds %q: %v", v, err)
				}
			case "max_body_bytes":
				var v string
				if !d.Args(&v) {
					return d.ArgErr()
				}
				if _, err := fmt.Sscanf(v, "%d", &m.MaxBodyBytes); err != nil {
					return d.Errf("invalid max_body_bytes %q: %v", v, err)
				}
			default:
				return d.Errf("unknown rioku_mirror directive: %q", d.Val())
			}
		}
	}
	return nil
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var m Mirror
	if err := m.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &m, nil
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*Mirror)(nil)
	_ caddy.Validator             = (*Mirror)(nil)
	_ caddyhttp.MiddlewareHandler = (*Mirror)(nil)
	_ caddyfile.Unmarshaler       = (*Mirror)(nil)
)
