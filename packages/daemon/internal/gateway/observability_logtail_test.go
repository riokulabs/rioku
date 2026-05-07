package gateway

import (
	"bufio"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestLogTailBuffer_HandleAppendsAndBroadcasts confirms the slog.Handler
// path: a record routed through the buffer lands in Snapshot() AND in
// any active subscriber channel.
func TestLogTailBuffer_HandleAppendsAndBroadcasts(t *testing.T) {
	buf := NewLogTailBuffer(8)
	logger := slog.New(buf)

	ch, unsub := buf.Subscribe(4)
	defer unsub()

	logger.Info("hello", "k", "v")

	select {
	case rec := <-ch:
		if rec.Msg != "hello" {
			t.Errorf("rec.Msg = %q, want hello", rec.Msg)
		}
		if rec.Fields["k"] != "v" {
			t.Errorf("rec.Fields[k] = %v, want v", rec.Fields["k"])
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber did not receive log line within 1s")
	}

	snap := buf.Snapshot()
	if len(snap) != 1 || snap[0].Msg != "hello" {
		t.Errorf("Snapshot = %+v, want one entry", snap)
	}
}

// TestLogTailBuffer_RingTrim confirms records past the cap evict the
// oldest entries.
func TestLogTailBuffer_RingTrim(t *testing.T) {
	buf := NewLogTailBuffer(3)
	logger := slog.New(buf)
	for i := 0; i < 5; i++ {
		logger.Info("m", "i", i)
	}
	snap := buf.Snapshot()
	if len(snap) != 3 {
		t.Fatalf("len = %d, want 3", len(snap))
	}
	// Oldest two ("i=0", "i=1") should have been evicted.
	if snap[0].Fields["i"].(int64) != 2 {
		t.Errorf("first remaining = %v, want i=2", snap[0].Fields["i"])
	}
}

// TestObservabilityLogsTail_StreamsSnapshotAndLive opens the SSE
// endpoint, then asserts a previously-buffered line replays AND a
// freshly-written line is delivered live.
func TestObservabilityLogsTail_StreamsSnapshotAndLive(t *testing.T) {
	tail := NewLogTailBuffer(16)
	logger := slog.New(tail)
	logger.Info("preexisting line")

	// Wire only the un-permission-gated handler so the test can hit
	// the SSE path directly. Auth wiring is covered by
	// TestObservabilityRoutes_RequiresAuth in the sibling file.
	srv := httptest.NewServer(http.HandlerFunc(handleLogsTail(tail)))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	// Snapshot replay should arrive immediately.
	got := readNextSSEData(t, scanner, time.Second)
	if !strings.Contains(got, "preexisting line") {
		t.Errorf("snapshot line = %q, want it to mention preexisting line", got)
	}

	// Now publish a live line and expect it on the wire.
	logger.Info("live line", "n", 7)
	got2 := readNextSSEData(t, scanner, time.Second)
	if !strings.Contains(got2, "live line") {
		t.Errorf("live line = %q, want it to mention live line", got2)
	}
}

// readNextSSEData scans until the next `data: ...` line and returns its
// payload portion. Empty lines and non-data prefixes (event:, id:) are
// skipped. Fails the test on timeout.
func readNextSSEData(t *testing.T, sc *bufio.Scanner, timeout time.Duration) string {
	t.Helper()
	deadline := time.Now().Add(timeout)
	out := make(chan string, 1)
	go func() {
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "data: ") {
				out <- strings.TrimPrefix(line, "data: ")
				return
			}
		}
		out <- ""
	}()
	select {
	case s := <-out:
		return s
	case <-time.After(time.Until(deadline)):
		t.Fatal("timeout waiting for SSE data line")
		return ""
	}
}

// TestObservabilityLogsTail_NilBufferEmitsDisabled covers the graceful-
// degradation path: when the daemon doesn't have a tail buffer wired
// the endpoint still opens and closes politely.
func TestObservabilityLogsTail_NilBufferEmitsDisabled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(handleLogsTail(nil)))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "event: disabled") {
			return
		}
	}
	t.Error("expected `event: disabled` line on nil-buffer stream")
}
