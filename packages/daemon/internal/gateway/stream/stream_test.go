package stream

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeFlusher wraps an httptest.ResponseRecorder to satisfy http.Flusher
// since the recorder doesn't implement it natively.
type fakeFlusher struct {
	*httptest.ResponseRecorder
	flushed int
	mu      sync.Mutex
}

func (f *fakeFlusher) Flush() {
	f.mu.Lock()
	f.flushed++
	f.mu.Unlock()
}

func (f *fakeFlusher) Flushes() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.flushed
}

func encodeString(s string) (string, []byte, error) {
	return "", []byte(s), nil
}

func TestStream_DeliversEvents(t *testing.T) {
	ch := make(chan string, 4)
	cleanupCalled := false
	s := Stream[string]{
		EventName: "msg",
		Encode:    encodeString,
		Subscribe: func(_ context.Context) (<-chan string, func(), error) {
			return ch, func() { cleanupCalled = true }, nil
		},
		Heartbeat: time.Hour, // disable heartbeat for this test
	}

	rec := &fakeFlusher{ResponseRecorder: httptest.NewRecorder()}
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/stream", nil).WithContext(ctx)

	done := make(chan struct{})
	go func() {
		defer close(done)
		s.Handler()(rec, req)
	}()

	ch <- "hello"
	ch <- "world"

	// Give the runner a moment to deliver events. We can't avoid a
	// short sleep here without exposing internal hooks; 100ms is well
	// under the 1s heartbeat interval.
	time.Sleep(100 * time.Millisecond)
	cancel()
	close(ch)
	<-done

	if !cleanupCalled {
		t.Error("cleanup func was not called")
	}

	body := rec.Body.String()
	if !strings.Contains(body, "event: msg\ndata: hello\n\n") {
		t.Errorf("missing first event in body:\n%s", body)
	}
	if !strings.Contains(body, "event: msg\ndata: world\n\n") {
		t.Errorf("missing second event in body:\n%s", body)
	}
	if rec.Flushes() < 3 { // initial + at least 2 events
		t.Errorf("flushes = %d, want >= 3", rec.Flushes())
	}
}

func TestStream_HeadersAreSet(t *testing.T) {
	ch := make(chan string)
	s := Stream[string]{
		EventName: "msg",
		Encode:    encodeString,
		Subscribe: func(_ context.Context) (<-chan string, func(), error) {
			return ch, func() { close(ch) }, nil
		},
	}

	rec := &fakeFlusher{ResponseRecorder: httptest.NewRecorder()}
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/stream", nil).WithContext(ctx)

	done := make(chan struct{})
	go func() {
		defer close(done)
		s.Handler()(rec, req)
	}()

	time.Sleep(20 * time.Millisecond)
	cancel()
	<-done

	headers := []struct{ name, want string }{
		{"Content-Type", "text/event-stream"},
		{"Cache-Control", "no-cache"},
		{"Connection", "keep-alive"},
		{"X-Accel-Buffering", "no"},
	}
	for _, h := range headers {
		if got := rec.Header().Get(h.name); got != h.want {
			t.Errorf("%s = %q, want %q", h.name, got, h.want)
		}
	}
}

func TestStream_HeartbeatEmitted(t *testing.T) {
	ch := make(chan string)
	s := Stream[string]{
		EventName: "msg",
		Encode:    encodeString,
		Subscribe: func(_ context.Context) (<-chan string, func(), error) {
			return ch, func() { close(ch) }, nil
		},
		Heartbeat: 30 * time.Millisecond,
	}

	rec := &fakeFlusher{ResponseRecorder: httptest.NewRecorder()}
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/stream", nil).WithContext(ctx)

	done := make(chan struct{})
	go func() {
		defer close(done)
		s.Handler()(rec, req)
	}()

	// Wait long enough for at least one heartbeat tick.
	time.Sleep(80 * time.Millisecond)
	cancel()
	<-done

	if !strings.Contains(rec.Body.String(), ": heartbeat ") {
		t.Errorf("expected heartbeat comment in body:\n%s", rec.Body.String())
	}
}

func TestStream_OverflowDropsAndAnnotates(t *testing.T) {
	// Source channel is buffered so the test can stuff events
	// without blocking on the runner's producer goroutine.
	ch := make(chan string, 100)
	s := Stream[string]{
		EventName: "msg",
		Encode:    encodeString,
		Subscribe: func(_ context.Context) (<-chan string, func(), error) {
			return ch, func() {}, nil
		},
		Heartbeat: time.Hour,
		Backlog:   2,
	}

	rec := &gatedFlusher{ResponseRecorder: httptest.NewRecorder(), gate: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/stream", nil).WithContext(ctx)

	done := make(chan struct{})
	go func() {
		defer close(done)
		s.Handler()(rec, req)
	}()

	// The handler's initial Flush is allowed; subsequent flushes
	// block until we release the gate. Push enough events to
	// overflow the local backlog (size 2) several times over.
	rec.AllowFirstFlush()
	time.Sleep(20 * time.Millisecond) // let runner reach the for-loop
	for i := 0; i < 10; i++ {
		ch <- fmt.Sprintf("v%d", i)
	}
	time.Sleep(50 * time.Millisecond) // give producer time to drop

	// Release the consumer so it drains the buffer.
	close(rec.gate)
	time.Sleep(80 * time.Millisecond)
	cancel()
	close(ch)
	<-done

	body := rec.Body.String()
	if !strings.Contains(body, ": dropped ") {
		t.Errorf("expected `: dropped N` annotation in body, got:\n%s", body)
	}
}

// gatedFlusher allows the FIRST Flush (the initial header flush) to
// pass through, then blocks on `gate` for every flush after that.
// This keeps the runner's local event buffer from draining so we can
// test the overflow-drop policy.
type gatedFlusher struct {
	*httptest.ResponseRecorder
	gate     chan struct{}
	mu       sync.Mutex
	count    int
	released bool
}

func (f *gatedFlusher) AllowFirstFlush() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.released = true
}

func (f *gatedFlusher) Flush() {
	f.mu.Lock()
	c := f.count
	f.count++
	released := f.released
	f.mu.Unlock()

	if c == 0 && released {
		return
	}
	<-f.gate
}

func TestStream_SubscribeError_ClosesCleanly(t *testing.T) {
	s := Stream[string]{
		EventName: "msg",
		Encode:    encodeString,
		Subscribe: func(_ context.Context) (<-chan string, func(), error) {
			return nil, func() {}, fmt.Errorf("subscribe failed")
		},
	}

	rec := &fakeFlusher{ResponseRecorder: httptest.NewRecorder()}
	req := httptest.NewRequest(http.MethodGet, "/stream", nil)
	s.Handler()(rec, req)

	// Headers were already written, so the response is 200; we just
	// verify the handler returned without a panic.
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestStream_SkipsEncoderErrors(t *testing.T) {
	ch := make(chan string, 4)
	s := Stream[string]{
		EventName: "msg",
		Encode: func(s string) (string, []byte, error) {
			if s == "skip" {
				return "", nil, ErrSkip
			}
			return "", []byte(s), nil
		},
		Subscribe: func(_ context.Context) (<-chan string, func(), error) {
			return ch, func() {}, nil
		},
		Heartbeat: time.Hour,
	}

	rec := &fakeFlusher{ResponseRecorder: httptest.NewRecorder()}
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/stream", nil).WithContext(ctx)

	done := make(chan struct{})
	go func() {
		defer close(done)
		s.Handler()(rec, req)
	}()

	ch <- "good"
	ch <- "skip"
	ch <- "also-good"
	time.Sleep(50 * time.Millisecond)
	cancel()
	close(ch)
	<-done

	body := rec.Body.String()
	if !strings.Contains(body, "data: good") || !strings.Contains(body, "data: also-good") {
		t.Errorf("good events missing:\n%s", body)
	}
	if strings.Contains(body, "data: skip") {
		t.Errorf("skip event leaked through:\n%s", body)
	}
}

// reader-helper used by the export tests below if we add SSE-protocol
// parsing later. Kept here so the package's test helpers live in one
// place.
func sseFrames(body io.Reader) []string {
	var frames []string
	scanner := bufio.NewScanner(body)
	var cur bytes.Buffer
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if cur.Len() > 0 {
				frames = append(frames, cur.String())
				cur.Reset()
			}
			continue
		}
		cur.WriteString(line)
		cur.WriteByte('\n')
	}
	if cur.Len() > 0 {
		frames = append(frames, cur.String())
	}
	return frames
}

var _ = sseFrames // exported for cross-package consumers if needed
