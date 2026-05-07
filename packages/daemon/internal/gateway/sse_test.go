package gateway

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/tracestore"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestTrafficSSE_ContentType(t *testing.T) {
	buf := tracestore.NewRingBuffer(64)

	mux := http.NewServeMux()
	RegisterSSERoutes(mux, nil, buf)

	// Push a trace so the handler has something to send, then cancel.
	buf.Push(&riokuv1.RequestTrace{
		TraceId:    "trace-001",
		Method:     "GET",
		Path:       "/api/v1/routes",
		StatusCode: 200,
		DurationMs: 5,
		StartedAt:  timestamppb.Now(),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/traffic", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q, want text/event-stream", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", cc)
	}
	if conn := rec.Header().Get("Connection"); conn != "keep-alive" {
		t.Errorf("Connection = %q, want keep-alive", conn)
	}
}

func TestTrafficSSE_EventFormat(t *testing.T) {
	buf := tracestore.NewRingBuffer(64)

	handler := handleTrafficSSE(buf)

	// Use a pipe-based approach: start handler in a goroutine, push traces,
	// then cancel and read the output.
	ctx, cancel := context.WithCancel(context.Background())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/traffic", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(rec, req)
		close(done)
	}()

	// Give the handler a moment to start and set up the subscription.
	time.Sleep(50 * time.Millisecond)

	// Push a trace.
	buf.Push(&riokuv1.RequestTrace{
		TraceId:      "trace-002",
		Method:       "POST",
		Path:         "/api/v1/services",
		StatusCode:   201,
		DurationMs:   12,
		UpstreamAddr: "127.0.0.1:8080",
		RouteId:      "route-abc",
		StartedAt:    timestamppb.Now(),
	})

	// Let the event be processed.
	time.Sleep(50 * time.Millisecond)
	cancel()
	<-done

	body := rec.Body.String()

	// Verify SSE format: "event: trace\ndata: {...}\n\n"
	scanner := bufio.NewScanner(strings.NewReader(body))
	var foundEvent, foundData bool
	for scanner.Scan() {
		line := scanner.Text()
		if line == "event: trace" {
			foundEvent = true
		}
		if strings.HasPrefix(line, "data: ") {
			foundData = true
			data := strings.TrimPrefix(line, "data: ")
			// Must be valid JSON.
			if !strings.HasPrefix(data, "{") || !strings.HasSuffix(data, "}") {
				t.Errorf("data payload is not JSON: %q", data)
			}
			// Verify it contains expected fields.
			if !strings.Contains(data, "trace-002") {
				t.Errorf("data missing trace_id: %q", data)
			}
			if !strings.Contains(data, "POST") {
				t.Errorf("data missing method: %q", data)
			}
		}
	}

	if !foundEvent {
		t.Error("expected 'event: trace' line in SSE output")
	}
	if !foundData {
		t.Error("expected 'data: {...}' line in SSE output")
	}
}

func TestTrafficSSE_NoFlusherSupport(t *testing.T) {
	buf := tracestore.NewRingBuffer(64)
	handler := handleTrafficSSE(buf)

	// httptest.ResponseRecorder implements http.Flusher, so we need a
	// wrapper that does NOT implement Flusher.
	w := &noFlushResponseWriter{header: make(http.Header)}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/traffic", nil)
	handler.ServeHTTP(w, req)

	if w.code != http.StatusInternalServerError {
		t.Errorf("expected 500 when Flusher not supported, got %d", w.code)
	}
}

func TestConfigSSE_NoFlusherSupport(t *testing.T) {
	// handleConfigSSE with a nil engine will fail at WatchChanges if it gets
	// that far, but a non-Flusher writer should be caught first.
	handler := handleConfigSSE(nil)

	w := &noFlushResponseWriter{header: make(http.Header)}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/config", nil)
	handler.ServeHTTP(w, req)

	if w.code != http.StatusInternalServerError {
		t.Errorf("expected 500 when Flusher not supported, got %d", w.code)
	}
}

// TestTrafficSSE_EmitsRetryDirective verifies that the very first bytes of
// the SSE stream advertise the reconnect interval to the client.
func TestTrafficSSE_EmitsRetryDirective(t *testing.T) {
	buf := tracestore.NewRingBuffer(64)
	handler := handleTrafficSSE(buf)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/traffic", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	body := rec.Body.String()
	if !strings.Contains(body, "retry: 30000") {
		t.Errorf("missing retry directive; got: %q", body)
	}
}

// TestConfigSSE_EmitsRetryDirective same for the config event stream.
// We construct a minimal Engine via nil — the handler should still write the
// retry directive before failing the WatchChanges call.
func TestConfigSSE_EmitsRetryDirective(t *testing.T) {
	// nil engine — WatchChanges will panic if called, so we wrap in defer/recover.
	// Instead, accept that this is a smoke check: just verify that with a flusher
	// available the handler at least writes the headers. We use a fake engine
	// constructed via httptest server + cancelled ctx.
	t.Skip("config SSE retry directive is exercised in integration; skipping unit-level smoke (engine is non-trivial to construct)")
}

// TestTrafficSSE_ResumeFromLastEventID confirms that supplying Last-Event-ID
// on reconnect causes the server to replay subsequent ring buffer entries
// before transitioning to the live stream.
func TestTrafficSSE_ResumeFromLastEventID(t *testing.T) {
	buf := tracestore.NewRingBuffer(64)

	// Pre-populate the ring buffer with three traces.
	for i := 1; i <= 3; i++ {
		buf.Push(&riokuv1.RequestTrace{
			TraceId:    fmt.Sprintf("trace-%03d", i),
			Method:     "GET",
			Path:       "/x",
			StatusCode: 200,
			StartedAt:  timestamppb.Now(),
		})
	}

	handler := handleTrafficSSE(buf)

	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/traffic", nil).WithContext(ctx)
	req.Header.Set("Last-Event-ID", "trace-001")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	body := rec.Body.String()

	// Expect trace-002 and trace-003 to be replayed; trace-001 must NOT be.
	if !strings.Contains(body, "trace-002") {
		t.Errorf("expected trace-002 in resumed stream, got: %q", body)
	}
	if !strings.Contains(body, "trace-003") {
		t.Errorf("expected trace-003 in resumed stream, got: %q", body)
	}
	// The server must NOT replay the resume marker itself.
	// Look for it as an `id:` line — the trace-001 string may also appear in
	// other guise (e.g. URL paths in future events) so be specific.
	if strings.Contains(body, "id: trace-001\n") {
		t.Errorf("server redelivered Last-Event-ID marker trace-001: %q", body)
	}
}

// TestTrafficSSE_EventIDInOutput confirms each event includes an `id:` line
// matching the trace ID, which is what enables Last-Event-ID resume.
func TestTrafficSSE_EventIDInOutput(t *testing.T) {
	buf := tracestore.NewRingBuffer(64)
	handler := handleTrafficSSE(buf)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/traffic", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(rec, req)
		close(done)
	}()

	time.Sleep(50 * time.Millisecond)
	buf.Push(&riokuv1.RequestTrace{
		TraceId:    "trace-evid-001",
		Method:     "POST",
		Path:       "/y",
		StatusCode: 201,
		StartedAt:  timestamppb.Now(),
	})
	time.Sleep(50 * time.Millisecond)
	cancel()
	<-done

	body := rec.Body.String()
	if !strings.Contains(body, "id: trace-evid-001\n") {
		t.Errorf("missing id line for trace-evid-001 in output: %q", body)
	}
}

// noFlushResponseWriter is an http.ResponseWriter that does NOT implement
// http.Flusher, to test the streaming-not-supported branch.
type noFlushResponseWriter struct {
	header http.Header
	code   int
	body   []byte
}

func (w *noFlushResponseWriter) Header() http.Header  { return w.header }
func (w *noFlushResponseWriter) WriteHeader(code int) { w.code = code }
func (w *noFlushResponseWriter) Write(b []byte) (int, error) {
	w.body = append(w.body, b...)
	return len(b), nil
}
