package caddy

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeAdmin returns a test server that emulates Caddy's
// /reverse_proxy/upstreams endpoint. The response body and status
// code are controlled by the supplied closures so tests can simulate
// failures and changing data.
func fakeAdmin(t *testing.T, body func() ([]byte, int)) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/reverse_proxy/upstreams", func(w http.ResponseWriter, r *http.Request) {
		b, code := body()
		w.WriteHeader(code)
		_, _ = w.Write(b)
	})
	return httptest.NewServer(mux)
}

func newPoller(t *testing.T, addr string, interval time.Duration) *UpstreamHealthPoller {
	t.Helper()
	return NewUpstreamHealthPoller(addr, interval, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestUpstreamHealthPoller_InitialSnapshotIsEmpty(t *testing.T) {
	p := newPoller(t, "127.0.0.1:0", time.Second)
	snap := p.Snapshot()
	if snap == nil {
		t.Fatal("Snapshot must never return nil")
	}
	if len(snap.Upstreams) != 0 {
		t.Errorf("expected empty Upstreams before first poll, got %d", len(snap.Upstreams))
	}
}

func TestUpstreamHealthPoller_PollPopulatesCache(t *testing.T) {
	srv := fakeAdmin(t, func() ([]byte, int) {
		return []byte(`[{"address":"10.0.0.1:8080","num_requests":42,"fails":1}]`), http.StatusOK
	})
	defer srv.Close()

	addr := strings.TrimPrefix(srv.URL, "http://")
	p := newPoller(t, addr, time.Second)
	if err := p.pollOnce(context.Background()); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	snap := p.Snapshot()
	if len(snap.Upstreams) != 1 {
		t.Fatalf("expected 1 upstream, got %d", len(snap.Upstreams))
	}
	got := snap.Upstreams[0]
	if got.Address != "10.0.0.1:8080" || got.NumRequests != 42 || got.Fails != 1 {
		t.Errorf("snapshot data wrong: %+v", got)
	}
	if snap.PolledAt.IsZero() {
		t.Error("PolledAt should be set after a successful poll")
	}
}

func TestUpstreamHealthPoller_PollFailureLeavesCacheIntact(t *testing.T) {
	// Toggle behavior between OK and 500 — the second poll should
	// not wipe the first poll's data.
	var count int32
	srv := fakeAdmin(t, func() ([]byte, int) {
		n := atomic.AddInt32(&count, 1)
		if n == 1 {
			return []byte(`[{"address":"a.com:80","num_requests":7,"fails":0}]`), http.StatusOK
		}
		return []byte(`internal error`), http.StatusInternalServerError
	})
	defer srv.Close()

	addr := strings.TrimPrefix(srv.URL, "http://")
	p := newPoller(t, addr, time.Second)

	if err := p.pollOnce(context.Background()); err != nil {
		t.Fatalf("first pollOnce: %v", err)
	}
	first := p.Snapshot()
	if len(first.Upstreams) != 1 {
		t.Fatalf("expected 1 upstream after first poll, got %d", len(first.Upstreams))
	}

	if err := p.pollOnce(context.Background()); err == nil {
		t.Fatal("expected second pollOnce to fail with 500")
	}
	second := p.Snapshot()
	if len(second.Upstreams) != 1 || second.Upstreams[0].Address != "a.com:80" {
		t.Errorf("cache should be unchanged after failed poll, got %+v", second.Upstreams)
	}
}

func TestUpstreamHealthPoller_StartStopRefreshesPeriodically(t *testing.T) {
	var hits int32
	srv := fakeAdmin(t, func() ([]byte, int) {
		atomic.AddInt32(&hits, 1)
		return []byte(`[]`), http.StatusOK
	})
	defer srv.Close()

	addr := strings.TrimPrefix(srv.URL, "http://")
	p := newPoller(t, addr, time.Second) // clamped to 1s minimum

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p.Start(ctx)

	// Wait long enough for at least 2 polls (initial + 1 ticked).
	time.Sleep(1100 * time.Millisecond)
	p.Stop()

	got := atomic.LoadInt32(&hits)
	if got < 2 {
		t.Errorf("expected at least 2 polls in 1.1s, got %d", got)
	}
}

func TestUpstreamHealthPoller_ConcurrentSnapshotReads(t *testing.T) {
	// Confirm Snapshot is safe to call from many goroutines while
	// pollOnce is updating the underlying pointer.
	var current atomic.Int32
	srv := fakeAdmin(t, func() ([]byte, int) {
		n := current.Add(1)
		body := struct {
			Address     string `json:"address"`
			NumRequests int    `json:"num_requests"`
			Fails       int    `json:"fails"`
		}{Address: "a.com:80", NumRequests: int(n), Fails: 0}
		b, _ := json.Marshal([]any{body})
		return b, http.StatusOK
	})
	defer srv.Close()

	addr := strings.TrimPrefix(srv.URL, "http://")
	p := newPoller(t, addr, time.Second)

	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_ = p.Snapshot()
				}
			}
		}()
	}
	for i := 0; i < 50; i++ {
		_ = p.pollOnce(context.Background())
	}
	close(stop)
	wg.Wait()
}

func TestUpstreamHealthPoller_NullArrayBecomesEmpty(t *testing.T) {
	srv := fakeAdmin(t, func() ([]byte, int) {
		return []byte(`null`), http.StatusOK
	})
	defer srv.Close()

	addr := strings.TrimPrefix(srv.URL, "http://")
	p := newPoller(t, addr, time.Second)
	if err := p.pollOnce(context.Background()); err != nil {
		t.Fatalf("pollOnce: %v", err)
	}
	snap := p.Snapshot()
	if snap.Upstreams == nil {
		t.Fatal("decoded null should become non-nil empty slice")
	}
	if len(snap.Upstreams) != 0 {
		t.Errorf("expected empty slice, got %d entries", len(snap.Upstreams))
	}
}

func TestUpstreamHealthPoller_IntervalClampedToOneSecond(t *testing.T) {
	p := NewUpstreamHealthPoller("127.0.0.1:0", 100*time.Millisecond, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if p.interval != time.Second {
		t.Errorf("interval = %v, want clamped to 1s", p.interval)
	}
}
