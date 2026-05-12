package caddy

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// testHandler collects slog records for inspection.
type testHandler struct {
	mu      sync.Mutex
	records []slog.Record
	attrs   [][]slog.Attr // per-record flattened attrs
}

func (h *testHandler) Enabled(_ context.Context, _ slog.Level) bool { return true }

func (h *testHandler) Handle(_ context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	var as []slog.Attr
	r.Attrs(func(a slog.Attr) bool {
		as = append(as, a)
		return true
	})
	h.records = append(h.records, r)
	h.attrs = append(h.attrs, as)
	return nil
}

func (h *testHandler) WithAttrs(attrs []slog.Attr) slog.Handler { return h }
func (h *testHandler) WithGroup(name string) slog.Handler       { return h }

func (h *testHandler) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.records)
}

func (h *testHandler) record(i int) slog.Record {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.records[i]
}

func (h *testHandler) attrMap(i int) map[string]slog.Value {
	h.mu.Lock()
	defer h.mu.Unlock()
	m := map[string]slog.Value{}
	for _, a := range h.attrs[i] {
		m[a.Key] = a.Value
	}
	return m
}

// newTestLogger returns a logger backed by a testHandler plus the handler itself.
func newTestLogger() (*slog.Logger, *testHandler) {
	h := &testHandler{}
	return slog.New(h), h
}

// ---------------------------------------------------------------------------
// TestBridge_JSONParse — well-formed Caddy JSON line
// ---------------------------------------------------------------------------

func TestBridge_JSONParse(t *testing.T) {
	line := `{"level":"info","ts":1715000000.5,"logger":"http.handlers.reverse_proxy","msg":"upstream healthy","upstream":"127.0.0.1:8080"}`
	stdout := strings.NewReader(line + "\n")
	stderr := strings.NewReader("")

	log, h := newTestLogger()
	ctx := context.Background()
	Bridge(ctx, stdout, stderr, log)

	if h.count() != 1 {
		t.Fatalf("expected 1 record, got %d", h.count())
	}
	rec := h.record(0)
	if rec.Level != slog.LevelInfo {
		t.Errorf("expected INFO, got %v", rec.Level)
	}
	if rec.Message != "upstream healthy" {
		t.Errorf("expected msg %q, got %q", "upstream healthy", rec.Message)
	}

	attrs := h.attrMap(0)
	if got := attrs["subsystem"].String(); got != "caddy" {
		t.Errorf("expected subsystem=caddy, got %q", got)
	}
	if got := attrs["caddy_logger"].String(); got != "http.handlers.reverse_proxy" {
		t.Errorf("expected caddy_logger=http.handlers.reverse_proxy, got %q", got)
	}
	// Extra field should be present.
	if _, ok := attrs["upstream"]; !ok {
		t.Error("expected upstream attr to be present")
	}
	// Timestamp should be parsed from ts field.
	if tsVal, ok := attrs["ts"]; ok {
		ts := tsVal.Time()
		expected := time.Unix(1715000000, 500000000).UTC()
		if !ts.Equal(expected) {
			t.Errorf("expected ts %v, got %v", expected, ts)
		}
	} else {
		t.Error("expected ts attr")
	}
}

// ---------------------------------------------------------------------------
// TestBridge_NonJSONFallback — garbage line falls back to INFO
// ---------------------------------------------------------------------------

func TestBridge_NonJSONFallback(t *testing.T) {
	line := "Caddy is now running in production"
	stdout := strings.NewReader(line + "\n")
	stderr := strings.NewReader("")

	log, h := newTestLogger()
	ctx := context.Background()
	Bridge(ctx, stdout, stderr, log)

	if h.count() != 1 {
		t.Fatalf("expected 1 record, got %d", h.count())
	}
	rec := h.record(0)
	if rec.Level != slog.LevelInfo {
		t.Errorf("expected INFO for non-JSON fallback, got %v", rec.Level)
	}
	if rec.Message != "caddy raw output" {
		t.Errorf("expected msg %q, got %q", "caddy raw output", rec.Message)
	}
	attrs := h.attrMap(0)
	if got := attrs["line"].String(); got != line {
		t.Errorf("expected line attr %q, got %q", line, got)
	}
	if got := attrs["stream"].String(); got != "stdout" {
		t.Errorf("expected stream=stdout, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// TestBridge_StreamTagging — stderr lines tagged with stream=stderr
// ---------------------------------------------------------------------------

func TestBridge_StreamTagging(t *testing.T) {
	stdout := strings.NewReader("")
	stderr := strings.NewReader("something from stderr\n")

	log, h := newTestLogger()
	ctx := context.Background()
	Bridge(ctx, stdout, stderr, log)

	if h.count() != 1 {
		t.Fatalf("expected 1 record, got %d", h.count())
	}
	attrs := h.attrMap(0)
	if got := attrs["stream"].String(); got != "stderr" {
		t.Errorf("expected stream=stderr for stderr line, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// TestBridge_LevelMapping — all Caddy levels map correctly
// ---------------------------------------------------------------------------

func TestBridge_LevelMapping(t *testing.T) {
	cases := []struct {
		caddyLevel string
		want       slog.Level
	}{
		{"debug", slog.LevelDebug},
		{"info", slog.LevelInfo},
		{"warn", slog.LevelWarn},
		{"error", slog.LevelError},
		{"panic", slog.LevelError},
		{"fatal", slog.LevelError},
		{"unknown", slog.LevelInfo}, // fallback
	}

	for _, tc := range cases {
		t.Run(tc.caddyLevel, func(t *testing.T) {
			line := `{"level":"` + tc.caddyLevel + `","ts":0,"logger":"test","msg":"hello"}`
			stdout := strings.NewReader(line + "\n")
			stderr := strings.NewReader("")

			log, h := newTestLogger()
			Bridge(context.Background(), stdout, stderr, log)

			if h.count() != 1 {
				t.Fatalf("expected 1 record, got %d", h.count())
			}
			if got := h.record(0).Level; got != tc.want {
				t.Errorf("caddyLevel=%q: expected slog level %v, got %v", tc.caddyLevel, tc.want, got)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// TestBridge_ContextCancel — cancel terminates bridge cleanly without leaks
// ---------------------------------------------------------------------------

func TestBridge_ContextCancel(t *testing.T) {
	// Use a pipe so Bridge blocks waiting for input.
	pr, pw := makeBlockingPipe(t)
	stderr := strings.NewReader("")

	log, _ := newTestLogger()
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		Bridge(ctx, pr, stderr, log)
		close(done)
	}()

	// Cancel context then close the write end — scanner will unblock.
	cancel()
	_ = pw.Close()

	select {
	case <-done:
		// Bridge returned cleanly.
	case <-time.After(2 * time.Second):
		t.Fatal("Bridge did not return after context cancel + pipe close")
	}
}

// makeBlockingPipe returns a (reader, writer) bytes.Buffer pair backed by a
// real pipe so Bridge will block until the writer is closed.
func makeBlockingPipe(t *testing.T) (*bytes.Buffer, *closableWriter) {
	t.Helper()
	buf := &bytes.Buffer{}
	cw := &closableWriter{buf: buf, done: make(chan struct{})}
	return buf, cw
}

// closableWriter is a bytes.Buffer that signals close via a channel.
type closableWriter struct {
	buf  *bytes.Buffer
	once sync.Once
	done chan struct{}
}

func (c *closableWriter) Close() error {
	c.once.Do(func() { close(c.done) })
	return nil
}

// ---------------------------------------------------------------------------
// TestBridge_MultipleLines — multiple JSON lines all emitted
// ---------------------------------------------------------------------------

func TestBridge_MultipleLines(t *testing.T) {
	lines := strings.Join([]string{
		`{"level":"info","ts":0,"logger":"http","msg":"started"}`,
		`{"level":"warn","ts":0,"logger":"tls","msg":"cert expiring soon"}`,
		`{"level":"error","ts":0,"logger":"core","msg":"shutdown error"}`,
	}, "\n") + "\n"

	stdout := strings.NewReader(lines)
	stderr := strings.NewReader("")

	log, h := newTestLogger()
	Bridge(context.Background(), stdout, stderr, log)

	if h.count() != 3 {
		t.Fatalf("expected 3 records, got %d", h.count())
	}
	if h.record(0).Level != slog.LevelInfo {
		t.Errorf("line 0: expected INFO")
	}
	if h.record(1).Level != slog.LevelWarn {
		t.Errorf("line 1: expected WARN")
	}
	if h.record(2).Level != slog.LevelError {
		t.Errorf("line 2: expected ERROR")
	}
}

// ---------------------------------------------------------------------------
// TestBridge_MixedStreams — lines from both stdout and stderr are captured
// ---------------------------------------------------------------------------

func TestBridge_MixedStreams(t *testing.T) {
	stdout := strings.NewReader(`{"level":"info","ts":0,"logger":"a","msg":"from stdout"}` + "\n")
	stderr := strings.NewReader("raw stderr line\n")

	log, h := newTestLogger()
	Bridge(context.Background(), stdout, stderr, log)

	if h.count() != 2 {
		t.Fatalf("expected 2 records, got %d", h.count())
	}

	// Find the non-JSON record.
	var foundRaw bool
	for i := 0; i < h.count(); i++ {
		if h.record(i).Message == "caddy raw output" {
			foundRaw = true
			if got := h.attrMap(i)["stream"].String(); got != "stderr" {
				t.Errorf("raw line stream: expected stderr, got %q", got)
			}
		}
	}
	if !foundRaw {
		t.Error("expected a raw output record from stderr")
	}
}
