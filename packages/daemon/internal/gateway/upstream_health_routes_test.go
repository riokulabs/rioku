package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/caddy"
)

// fakeUpstreamHealthSource is a hand-rolled UpstreamHealthSource for
// tests. We avoid using a real caddy.UpstreamHealthPoller so the
// tests don't need an HTTP fake admin server.
type fakeUpstreamHealthSource struct {
	snap *caddy.UpstreamHealthSnapshot
}

func (f *fakeUpstreamHealthSource) Snapshot() *caddy.UpstreamHealthSnapshot {
	return f.snap
}

func TestUpstreamHealth_NilSourceReturnsUnavailable(t *testing.T) {
	mux := http.NewServeMux()
	RegisterUpstreamHealthRoutes(mux, nil)

	req := authedRequest(http.MethodGet, "/api/v1/upstreams/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body upstreamHealthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Available {
		t.Error("expected available=false when source is nil")
	}
	if body.Upstreams == nil {
		t.Error("upstreams must be a non-nil empty slice, not null")
	}
}

func TestUpstreamHealth_LiveSourceReturnsSnapshot(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	src := &fakeUpstreamHealthSource{
		snap: &caddy.UpstreamHealthSnapshot{
			PolledAt: now,
			Upstreams: []caddy.UpstreamHealth{
				{Address: "10.0.0.1:8080", NumRequests: 42, Fails: 1},
				{Address: "10.0.0.2:8080", NumRequests: 7, Fails: 0},
			},
		},
	}

	mux := http.NewServeMux()
	RegisterUpstreamHealthRoutes(mux, src)

	req := authedRequest(http.MethodGet, "/api/v1/upstreams/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body upstreamHealthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Available {
		t.Error("expected available=true when source is wired")
	}
	if len(body.Upstreams) != 2 {
		t.Fatalf("expected 2 upstreams, got %d", len(body.Upstreams))
	}
	if !body.PolledAt.Equal(now) {
		t.Errorf("PolledAt = %v, want %v", body.PolledAt, now)
	}
	if body.Upstreams[0].Address != "10.0.0.1:8080" || body.Upstreams[0].NumRequests != 42 {
		t.Errorf("upstream[0] = %+v", body.Upstreams[0])
	}
}

func TestUpstreamHealth_RequiresPermission(t *testing.T) {
	// No SessionClaims in context — the RequirePermission middleware
	// should reject with 401 before the handler runs.
	mux := http.NewServeMux()
	RegisterUpstreamHealthRoutes(mux, &fakeUpstreamHealthSource{
		snap: &caddy.UpstreamHealthSnapshot{Upstreams: []caddy.UpstreamHealth{}},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/upstreams/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Errorf("expected non-200 for unauthenticated request, got %d", rec.Code)
	}
}

func TestUpstreamHealth_NilSliceFromSourceBecomesEmpty(t *testing.T) {
	// Source returns a snapshot with nil Upstreams (defensive corner
	// case, though the poller normally guarantees non-nil). Handler
	// should normalize to an empty slice.
	src := &fakeUpstreamHealthSource{
		snap: &caddy.UpstreamHealthSnapshot{Upstreams: nil},
	}

	mux := http.NewServeMux()
	RegisterUpstreamHealthRoutes(mux, src)

	req := authedRequest(http.MethodGet, "/api/v1/upstreams/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	var body upstreamHealthResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Upstreams == nil {
		t.Error("nil source slice should be normalized to non-nil empty slice")
	}
}
