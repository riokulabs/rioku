package mirror

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

// nextHandlerOK is a minimal caddyhttp.Handler that records that the
// primary path executed and writes 200 OK.
type nextHandlerOK struct {
	called atomic.Int32
	body   []byte
	mu     sync.Mutex
}

func (h *nextHandlerOK) ServeHTTP(w http.ResponseWriter, r *http.Request) error {
	h.called.Add(1)
	if r.Body != nil {
		b, _ := io.ReadAll(r.Body)
		h.mu.Lock()
		h.body = b
		h.mu.Unlock()
	}
	w.WriteHeader(http.StatusOK)
	return nil
}

func (h *nextHandlerOK) primaryBody() []byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.body
}

func provision(t *testing.T, m *Mirror) {
	t.Helper()
	if err := m.Provision(caddy.Context{}); err != nil {
		t.Fatalf("provision: %v", err)
	}
	if err := m.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

func waitFor(t *testing.T, cond func() bool, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("condition not met within %s", timeout)
}

func TestProvisionRejectsEmptyMirrorURL(t *testing.T) {
	m := &Mirror{}
	if err := m.Provision(caddy.Context{}); err == nil {
		t.Fatalf("expected error for empty MirrorURL, got nil")
	}
}

func TestProvisionAppliesDefaults(t *testing.T) {
	m := &Mirror{MirrorURL: "http://example.invalid"}
	provision(t, m)

	if m.SampleRate != defaultSampleRate {
		t.Errorf("SampleRate default = %v, want %v", m.SampleRate, defaultSampleRate)
	}
	if m.TimeoutSeconds != defaultTimeoutSeconds {
		t.Errorf("TimeoutSeconds default = %d, want %d", m.TimeoutSeconds, defaultTimeoutSeconds)
	}
	if m.MaxBodyBytes != defaultMaxBodyBytes {
		t.Errorf("MaxBodyBytes default = %d, want %d", m.MaxBodyBytes, defaultMaxBodyBytes)
	}
}

func TestProvisionRejectsOutOfRangeSampleRate(t *testing.T) {
	cases := []float64{-0.1, 1.5, 2.0}
	for _, c := range cases {
		m := &Mirror{MirrorURL: "http://example.invalid", SampleRate: c}
		if err := m.Provision(caddy.Context{}); err == nil {
			t.Errorf("expected error for SampleRate=%v", c)
		}
	}
}

func TestSampleRateOneMirrorsEveryRequest(t *testing.T) {
	var mirrorHits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mirrorHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	m := &Mirror{MirrorURL: upstream.URL, SampleRate: 1.0}
	provision(t, m)

	next := &nextHandlerOK{}
	const N = 25
	for i := 0; i < N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/foo", nil)
		w := httptest.NewRecorder()
		if err := m.ServeHTTP(w, req, next); err != nil {
			t.Fatalf("ServeHTTP: %v", err)
		}
		if w.Code != http.StatusOK {
			t.Fatalf("primary status=%d, want 200", w.Code)
		}
	}
	if got := next.called.Load(); got != N {
		t.Errorf("primary called %d times, want %d", got, N)
	}

	waitFor(t, func() bool { return mirrorHits.Load() == N }, 2*time.Second)
}

func TestSampleRateZeroMirrorsNothing(t *testing.T) {
	var mirrorHits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mirrorHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	// SampleRate = 0 is the "default" trigger inside Provision, so we
	// pass an explicit small-but-zero-equivalent path: set it to a
	// negative value first to confirm rejection, then test with the
	// shouldMirror short-circuit by setting SampleRate to 0 *after*
	// Provision.
	m := &Mirror{MirrorURL: upstream.URL, SampleRate: 1.0}
	provision(t, m)
	m.SampleRate = 0 // force "disabled" post-provision

	next := &nextHandlerOK{}
	for i := 0; i < 50; i++ {
		req := httptest.NewRequest(http.MethodGet, "/foo", nil)
		w := httptest.NewRecorder()
		if err := m.ServeHTTP(w, req, next); err != nil {
			t.Fatalf("ServeHTTP: %v", err)
		}
	}
	// Give any (incorrectly) launched goroutines a moment to land.
	time.Sleep(100 * time.Millisecond)
	if got := mirrorHits.Load(); got != 0 {
		t.Errorf("mirror hits = %d, want 0", got)
	}
	if got := next.called.Load(); got != 50 {
		t.Errorf("primary called %d times, want 50", got)
	}
}

func TestSampleRateHalfApproximate(t *testing.T) {
	var mirrorHits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mirrorHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	m := &Mirror{MirrorURL: upstream.URL, SampleRate: 0.5}
	provision(t, m)

	next := &nextHandlerOK{}
	const N = 1000
	for i := 0; i < N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/foo", nil)
		w := httptest.NewRecorder()
		if err := m.ServeHTTP(w, req, next); err != nil {
			t.Fatalf("ServeHTTP: %v", err)
		}
	}

	// Wait for in-flight mirror requests to settle. We poll for a
	// stable count rather than asserting an exact equality.
	deadline := time.Now().Add(3 * time.Second)
	var last int32
	for time.Now().Before(deadline) {
		v := mirrorHits.Load()
		if v == last && v > 0 {
			break
		}
		last = v
		time.Sleep(50 * time.Millisecond)
	}

	hits := mirrorHits.Load()
	if hits < 400 || hits > 600 {
		t.Errorf("mirror hits = %d, expected 400..600 for SampleRate=0.5, N=%d", hits, N)
	}
}

func TestBodyForwardedToMirror(t *testing.T) {
	var mirrorBody atomic.Value
	mirrorReceived := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mirrorBody.Store(string(b))
		select {
		case mirrorReceived <- struct{}{}:
		default:
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	m := &Mirror{MirrorURL: upstream.URL, SampleRate: 1.0}
	provision(t, m)

	const payload = "hello mirror world"
	req := httptest.NewRequest(http.MethodPost, "/echo", strings.NewReader(payload))
	w := httptest.NewRecorder()

	next := &nextHandlerOK{}
	if err := m.ServeHTTP(w, req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}

	// Primary handler must see the full body.
	if got := string(next.primaryBody()); got != payload {
		t.Errorf("primary body = %q, want %q", got, payload)
	}

	select {
	case <-mirrorReceived:
	case <-time.After(2 * time.Second):
		t.Fatalf("mirror upstream did not receive request")
	}
	if got, _ := mirrorBody.Load().(string); got != payload {
		t.Errorf("mirror body = %q, want %q", got, payload)
	}
}

func TestLargeBodySkipsMirror(t *testing.T) {
	var mirrorHits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mirrorHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	m := &Mirror{MirrorURL: upstream.URL, SampleRate: 1.0, MaxBodyBytes: 16}
	provision(t, m)

	payload := strings.Repeat("x", 1024)
	req := httptest.NewRequest(http.MethodPost, "/big", strings.NewReader(payload))
	w := httptest.NewRecorder()

	next := &nextHandlerOK{}
	if err := m.ServeHTTP(w, req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}

	// Primary handler must still see the full body.
	if got := string(next.primaryBody()); got != payload {
		t.Errorf("primary body length = %d, want %d", len(got), len(payload))
	}

	// Confirm the mirror upstream was never contacted.
	time.Sleep(150 * time.Millisecond)
	if got := mirrorHits.Load(); got != 0 {
		t.Errorf("mirror hits = %d, want 0 (body exceeded MaxBodyBytes)", got)
	}
}

func TestHopByHopHeadersStripped(t *testing.T) {
	var mirrorHeaders atomic.Value
	mirrorReceived := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Capture a copy because r is recycled.
		captured := make(http.Header, len(r.Header))
		for k, v := range r.Header {
			cp := make([]string, len(v))
			copy(cp, v)
			captured[k] = cp
		}
		mirrorHeaders.Store(captured)
		select {
		case mirrorReceived <- struct{}{}:
		default:
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	m := &Mirror{MirrorURL: upstream.URL, SampleRate: 1.0}
	provision(t, m)

	req := httptest.NewRequest(http.MethodGet, "/h", nil)
	req.Header.Set("Connection", "close, X-Custom-Drop")
	req.Header.Set("Keep-Alive", "timeout=5")
	req.Header.Set("Te", "trailers")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("X-Custom-Drop", "should-be-removed-by-connection-tokens")
	req.Header.Set("X-Forwarded-For", "10.0.0.1")

	w := httptest.NewRecorder()
	next := &nextHandlerOK{}
	if err := m.ServeHTTP(w, req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}

	select {
	case <-mirrorReceived:
	case <-time.After(2 * time.Second):
		t.Fatalf("mirror did not receive request")
	}

	got, _ := mirrorHeaders.Load().(http.Header)
	for _, name := range []string{"Connection", "Keep-Alive", "Te", "Upgrade", "X-Custom-Drop"} {
		if v := got.Get(name); v != "" {
			t.Errorf("header %q = %q, want stripped", name, v)
		}
	}
	// Non hop-by-hop header must survive.
	if v := got.Get("X-Forwarded-For"); v != "10.0.0.1" {
		t.Errorf("X-Forwarded-For = %q, want passthrough", v)
	}
}

func TestPrimarySucceedsWhenMirrorReturns500(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()

	m := &Mirror{MirrorURL: upstream.URL, SampleRate: 1.0}
	provision(t, m)

	req := httptest.NewRequest(http.MethodPost, "/p", bytes.NewReader([]byte("body")))
	w := httptest.NewRecorder()
	next := &nextHandlerOK{}
	if err := m.ServeHTTP(w, req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if w.Code != http.StatusOK {
		t.Errorf("primary status=%d, want 200 even though mirror 500", w.Code)
	}
	if next.called.Load() != 1 {
		t.Errorf("primary called %d times, want 1", next.called.Load())
	}
}

func TestMirrorTimeoutDoesNotBlockPrimary(t *testing.T) {
	// Mirror upstream that hangs forever (until test cleanup closes
	// it). The mirror request must time out without affecting the
	// primary path.
	block := make(chan struct{})
	t.Cleanup(func() { close(block) })

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-block
	}))
	defer upstream.Close()

	m := &Mirror{
		MirrorURL:      upstream.URL,
		SampleRate:     1.0,
		TimeoutSeconds: 1,
	}
	provision(t, m)

	start := time.Now()
	req := httptest.NewRequest(http.MethodGet, "/slow", nil)
	w := httptest.NewRecorder()
	next := &nextHandlerOK{}
	if err := m.ServeHTTP(w, req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	elapsed := time.Since(start)
	if elapsed > 500*time.Millisecond {
		t.Errorf("primary path blocked for %v, want <500ms (mirror is fire-and-forget)", elapsed)
	}
	if w.Code != http.StatusOK {
		t.Errorf("primary status=%d, want 200", w.Code)
	}
}

func TestUnmarshalCaddyfile(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		wantURL string
	}{
		{
			name: "all fields",
			input: `rioku_mirror {
				mirror_url http://shadow.invalid:8080
				sample_rate 0.25
				timeout_seconds 7
				max_body_bytes 2048
			}`,
			wantURL: "http://shadow.invalid:8080",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := caddyfile.NewTestDispenser(tc.input)
			var m Mirror
			if err := m.UnmarshalCaddyfile(d); err != nil {
				t.Fatalf("UnmarshalCaddyfile: %v", err)
			}
			if m.MirrorURL != tc.wantURL {
				t.Errorf("MirrorURL = %q, want %q", m.MirrorURL, tc.wantURL)
			}
			if m.SampleRate != 0.25 {
				t.Errorf("SampleRate = %v, want 0.25", m.SampleRate)
			}
			if m.TimeoutSeconds != 7 {
				t.Errorf("TimeoutSeconds = %d, want 7", m.TimeoutSeconds)
			}
			if m.MaxBodyBytes != 2048 {
				t.Errorf("MaxBodyBytes = %d, want 2048", m.MaxBodyBytes)
			}
		})
	}
}

// Compile-time check that &Mirror{} implements the middleware interface
// — protects against accidental signature drift.
var _ caddyhttp.MiddlewareHandler = (*Mirror)(nil)
