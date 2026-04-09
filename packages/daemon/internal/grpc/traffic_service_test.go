package grpc

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/tracestore"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	_ "github.com/riokulabs/rioku/internal/tracestore/sqlite"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// openTestStore creates a fresh SQLite trace store in a temp directory.
func openTestStore(t *testing.T) tracestore.Driver {
	t.Helper()
	dir := t.TempDir()
	d, err := tracestore.New("sqlite")
	if err != nil {
		t.Fatalf("tracestore.New: %v", err)
	}
	err = d.Open(context.Background(), tracestore.DriverConfig{
		Driver: "sqlite",
		Path:   filepath.Join(dir, "traces.db"),
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() {
		if err := d.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	return d
}

// makeTrace creates a RequestTrace with the given parameters.
func makeTrace(id string, startedAt time.Time, statusCode int32, routeID, sessionID string) *riokuv1.RequestTrace {
	return &riokuv1.RequestTrace{
		TraceId:    id,
		SpanId:     "span-" + id,
		SessionId:  sessionID,
		StartedAt:  timestamppb.New(startedAt),
		DurationMs: 42,
		Method:     "GET",
		Path:       "/api/test",
		Host:       "localhost",
		RouteId:    routeID,
		ServiceId:  "svc-1",
		StatusCode: statusCode,
		BytesSent:  1024,
		BytesRecv:  512,
		ActorId:    "user-1",
		ActorType:  "api_key",
		PolicyIds:  []string{"pol-1"},
		AuthResult: "pass",
	}
}

// newTestTrafficService creates a trafficService backed by a fresh SQLite store
// and a ring buffer.
func newTestTrafficService(t *testing.T) (*trafficService, tracestore.Driver, *tracestore.RingBuffer) {
	t.Helper()
	store := openTestStore(t)
	buf := tracestore.NewRingBuffer(1024)
	svc := newTrafficService(buf, store)
	return svc, store, buf
}

// ---------------------------------------------------------------------------
// Mock stream for WatchTraffic
// ---------------------------------------------------------------------------

type mockTrafficStream struct {
	grpc.ServerStreamingServer[riokuv1.RequestTrace]
	ctx    context.Context
	traces []*riokuv1.RequestTrace
	mu     sync.Mutex
}

func (m *mockTrafficStream) Send(t *riokuv1.RequestTrace) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.traces = append(m.traces, t)
	return nil
}

func (m *mockTrafficStream) Context() context.Context { return m.ctx }

func (m *mockTrafficStream) getTraces() []*riokuv1.RequestTrace {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*riokuv1.RequestTrace, len(m.traces))
	copy(out, m.traces)
	return out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestTrafficService_QueryTraces(t *testing.T) {
	svc, store, _ := newTestTrafficService(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)

	// Write 50 traces: 30 with status 200 on route-a, 20 with status 500 on route-b.
	traces := make([]*riokuv1.RequestTrace, 50)
	for i := range 30 {
		traces[i] = makeTrace(
			fmt.Sprintf("t200-%03d", i),
			now.Add(time.Duration(i)*time.Second),
			200, "route-a", "",
		)
	}
	for i := range 20 {
		traces[30+i] = makeTrace(
			fmt.Sprintf("t500-%03d", i),
			now.Add(time.Duration(30+i)*time.Second),
			500, "route-b", "",
		)
	}

	if err := store.WriteBatch(ctx, traces); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	// Query with status filter = 500.
	result, err := svc.QueryTraces(ctx, &riokuv1.TraceQuery{
		StatusCodes: []int32{500},
		Page:        &riokuv1.PageRequest{PageSize: 100},
	})
	if err != nil {
		t.Fatalf("QueryTraces: %v", err)
	}
	if result.GetPage().GetTotal() != 20 {
		t.Errorf("total = %d, want 20", result.GetPage().GetTotal())
	}
	if len(result.GetTraces()) != 20 {
		t.Errorf("len(traces) = %d, want 20", len(result.GetTraces()))
	}

	// Verify all returned traces have status 500.
	for _, tr := range result.GetTraces() {
		if tr.GetStatusCode() != 500 {
			t.Errorf("trace %q has status %d, want 500", tr.GetTraceId(), tr.GetStatusCode())
		}
	}

	// Query all traces.
	allResult, err := svc.QueryTraces(ctx, &riokuv1.TraceQuery{
		Page: &riokuv1.PageRequest{PageSize: 100},
	})
	if err != nil {
		t.Fatalf("QueryTraces all: %v", err)
	}
	if allResult.GetPage().GetTotal() != 50 {
		t.Errorf("total = %d, want 50", allResult.GetPage().GetTotal())
	}
}

func TestTrafficService_GetTrace(t *testing.T) {
	svc, store, _ := newTestTrafficService(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)

	tr := makeTrace("find-me", now, 201, "route-x", "sess-1")
	tr.Ai = &riokuv1.AITrace{
		Provider:         "openai",
		Model:            "gpt-4",
		InputTokens:      100,
		OutputTokens:     50,
		TotalTokens:      150,
		EstimatedCostUsd: 0.0042,
	}

	if err := store.WriteBatch(ctx, []*riokuv1.RequestTrace{tr}); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	// Get existing trace.
	got, err := svc.GetTrace(ctx, &riokuv1.GetTraceRequest{TraceId: "find-me"})
	if err != nil {
		t.Fatalf("GetTrace: %v", err)
	}
	if got.GetTraceId() != "find-me" {
		t.Errorf("trace_id = %q, want %q", got.GetTraceId(), "find-me")
	}
	if got.GetStatusCode() != 201 {
		t.Errorf("status_code = %d, want 201", got.GetStatusCode())
	}
	if got.GetRouteId() != "route-x" {
		t.Errorf("route_id = %q, want %q", got.GetRouteId(), "route-x")
	}
	if got.GetSessionId() != "sess-1" {
		t.Errorf("session_id = %q, want %q", got.GetSessionId(), "sess-1")
	}
	if got.GetDurationMs() != 42 {
		t.Errorf("duration_ms = %d, want 42", got.GetDurationMs())
	}
	if ai := got.GetAi(); ai == nil {
		t.Error("ai is nil")
	} else {
		if ai.GetProvider() != "openai" {
			t.Errorf("ai.provider = %q, want %q", ai.GetProvider(), "openai")
		}
		if ai.GetTotalTokens() != 150 {
			t.Errorf("ai.total_tokens = %d, want 150", ai.GetTotalTokens())
		}
	}

	// Get non-existent trace: expect NotFound.
	_, err = svc.GetTrace(ctx, &riokuv1.GetTraceRequest{TraceId: "does-not-exist"})
	if err == nil {
		t.Fatal("expected error for non-existent trace")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %v", err)
	}
	if st.Code() != codes.NotFound {
		t.Errorf("code = %v, want NotFound", st.Code())
	}
}

func TestTrafficService_GetStats(t *testing.T) {
	svc, store, _ := newTestTrafficService(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	// Write 5 stats buckets.
	for i := range 5 {
		b := tracestore.StatsBucket{
			BucketStart:  base.Add(time.Duration(i) * time.Minute),
			RequestCount: int64(100 + i*10),
			ErrorCount:   int64(i),
			P50LatencyMS: 10,
			P95LatencyMS: 50,
			P99LatencyMS: 100,
			BytesSent:    int64(1000 * (i + 1)),
			BytesRecv:    int64(500 * (i + 1)),
		}
		if err := store.WriteStatsBucket(ctx, b); err != nil {
			t.Fatalf("WriteStatsBucket(%d): %v", i, err)
		}
	}

	result, err := svc.GetStats(ctx, &riokuv1.StatsQuery{
		Since: timestamppb.New(base),
		Until: timestamppb.New(base.Add(4 * time.Minute)),
	})
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}

	if len(result.GetBuckets()) != 5 {
		t.Fatalf("len(buckets) = %d, want 5", len(result.GetBuckets()))
	}

	// Check first bucket.
	first := result.GetBuckets()[0]
	if first.GetRequestCount() != 100 {
		t.Errorf("buckets[0].RequestCount = %d, want 100", first.GetRequestCount())
	}
	if first.GetP50LatencyMs() != 10 {
		t.Errorf("buckets[0].P50LatencyMs = %d, want 10", first.GetP50LatencyMs())
	}

	// Check last bucket.
	last := result.GetBuckets()[4]
	if last.GetRequestCount() != 140 {
		t.Errorf("buckets[4].RequestCount = %d, want 140", last.GetRequestCount())
	}
	if last.GetBytesSent() != 5000 {
		t.Errorf("buckets[4].BytesSent = %d, want 5000", last.GetBytesSent())
	}
}

func TestTrafficService_GetTokenStats(t *testing.T) {
	svc, store, _ := newTestTrafficService(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	// Write model buckets for 2 models across 3 time slots.
	modelBuckets := []tracestore.ModelBucket{
		{BucketStart: base, Provider: "openai", Model: "gpt-4", RequestCount: 10, TotalTokens: 5000, EstimatedCostUSD: 0.50},
		{BucketStart: base, Provider: "anthropic", Model: "claude-3", RequestCount: 5, TotalTokens: 3000, EstimatedCostUSD: 0.30},
		{BucketStart: base.Add(time.Minute), Provider: "openai", Model: "gpt-4", RequestCount: 8, TotalTokens: 4000, EstimatedCostUSD: 0.40},
		{BucketStart: base.Add(time.Minute), Provider: "anthropic", Model: "claude-3", RequestCount: 6, TotalTokens: 3500, EstimatedCostUSD: 0.35},
	}
	for i, mb := range modelBuckets {
		if err := store.WriteModelBucket(ctx, mb); err != nil {
			t.Fatalf("WriteModelBucket(%d): %v", i, err)
		}
	}

	result, err := svc.GetTokenStats(ctx, &riokuv1.TokenQuery{
		Since: timestamppb.New(base),
		Until: timestamppb.New(base.Add(time.Minute)),
	})
	if err != nil {
		t.Fatalf("GetTokenStats: %v", err)
	}

	// Verify totals.
	totals := result.GetTotals()
	if totals == nil {
		t.Fatal("totals is nil")
	}
	if totals.GetTotalTokens() != 15500 {
		t.Errorf("totals.TotalTokens = %d, want 15500", totals.GetTotalTokens())
	}
	if totals.GetRequestCount() != 29 {
		t.Errorf("totals.RequestCount = %d, want 29", totals.GetRequestCount())
	}
	// Cost: 0.50 + 0.30 + 0.40 + 0.35 = 1.55
	if totals.GetEstimatedCostUsd() < 1.54 || totals.GetEstimatedCostUsd() > 1.56 {
		t.Errorf("totals.EstimatedCostUsd = %f, want ~1.55", totals.GetEstimatedCostUsd())
	}

	// Verify model breakdown contains both models.
	breakdown := result.GetModelBreakdown()
	if len(breakdown) != 2 {
		t.Fatalf("len(breakdown) = %d, want 2", len(breakdown))
	}
	found := make(map[string]int64)
	for _, bd := range breakdown {
		found[bd.GetModel()] = bd.GetTotalTokens()
	}
	if found["gpt-4"] != 9000 {
		t.Errorf("gpt-4 tokens = %d, want 9000", found["gpt-4"])
	}
	if found["claude-3"] != 6500 {
		t.Errorf("claude-3 tokens = %d, want 6500", found["claude-3"])
	}

	// Verify buckets count.
	if len(result.GetBuckets()) != 4 {
		t.Errorf("len(buckets) = %d, want 4", len(result.GetBuckets()))
	}
}

func TestTrafficService_ListSessions(t *testing.T) {
	svc, store, _ := newTestTrafficService(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// Write traces for 2 sessions.
	traces := []*riokuv1.RequestTrace{
		makeTrace("sa-1", now, 200, "route-1", "session-alpha"),
		makeTrace("sa-2", now.Add(time.Second), 200, "route-1", "session-alpha"),
		makeTrace("sa-3", now.Add(2*time.Second), 200, "route-1", "session-alpha"),
		makeTrace("sb-1", now.Add(3*time.Second), 200, "route-2", "session-beta"),
		makeTrace("sb-2", now.Add(4*time.Second), 200, "route-2", "session-beta"),
	}
	for _, tr := range traces {
		tr.Ai = &riokuv1.AITrace{
			Provider:    "openai",
			Model:       "gpt-4",
			TotalTokens: 100,
		}
	}

	if err := store.WriteBatch(ctx, traces); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	result, err := svc.ListSessions(ctx, &riokuv1.SessionQuery{
		Page: &riokuv1.PageRequest{PageSize: 50},
	})
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}

	if result.GetPage().GetTotal() != 2 {
		t.Errorf("total = %d, want 2", result.GetPage().GetTotal())
	}
	if len(result.GetSessions()) != 2 {
		t.Errorf("len(sessions) = %d, want 2", len(result.GetSessions()))
	}

	// Verify session details by ID.
	turnsBySession := make(map[string]int32)
	for _, s := range result.GetSessions() {
		turnsBySession[s.GetSessionId()] = s.GetTurnCount()
	}
	if turnsBySession["session-alpha"] != 3 {
		t.Errorf("session-alpha turns = %d, want 3", turnsBySession["session-alpha"])
	}
	if turnsBySession["session-beta"] != 2 {
		t.Errorf("session-beta turns = %d, want 2", turnsBySession["session-beta"])
	}
}

func TestTrafficService_GetSession(t *testing.T) {
	svc, store, _ := newTestTrafficService(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// Write traces for one session.
	traces := []*riokuv1.RequestTrace{
		makeTrace("gs-1", now, 200, "route-1", "sess-detail"),
		makeTrace("gs-2", now.Add(time.Second), 200, "route-1", "sess-detail"),
		makeTrace("gs-3", now.Add(2*time.Second), 500, "route-1", "sess-detail"),
	}
	for _, tr := range traces {
		tr.Ai = &riokuv1.AITrace{
			Provider:         "anthropic",
			Model:            "claude-3",
			TotalTokens:      200,
			EstimatedCostUsd: 0.02,
			AgentId:          "agent-007",
		}
	}

	if err := store.WriteBatch(ctx, traces); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	result, err := svc.GetSession(ctx, &riokuv1.GetSessionRequest{SessionId: "sess-detail"})
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}

	// Verify turns.
	if len(result.GetTurns()) != 3 {
		t.Errorf("len(turns) = %d, want 3", len(result.GetTurns()))
	}

	// Verify session summary.
	session := result.GetSession()
	if session == nil {
		t.Fatal("session is nil")
	}
	if session.GetSessionId() != "sess-detail" {
		t.Errorf("session_id = %q, want %q", session.GetSessionId(), "sess-detail")
	}
	if session.GetTurnCount() != 3 {
		t.Errorf("turn_count = %d, want 3", session.GetTurnCount())
	}
	if session.GetTotalTokens() != 600 {
		t.Errorf("total_tokens = %d, want 600", session.GetTotalTokens())
	}
	// Note: AgentId is not persisted by the SQLite driver, so we don't assert it here.
	// The buildSessionSummary function correctly extracts it from AITrace when present.

	// Not found case.
	_, err = svc.GetSession(ctx, &riokuv1.GetSessionRequest{SessionId: "no-such-session"})
	if err == nil {
		t.Fatal("expected error for non-existent session")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %v", err)
	}
	if st.Code() != codes.NotFound {
		t.Errorf("code = %v, want NotFound", st.Code())
	}
}

func TestTrafficService_WatchTraffic(t *testing.T) {
	svc, _, buf := newTestTrafficService(t)
	now := time.Now().UTC()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream := &mockTrafficStream{ctx: ctx}

	// Run WatchTraffic in a goroutine.
	errCh := make(chan error, 1)
	go func() {
		errCh <- svc.WatchTraffic(&riokuv1.WatchTrafficRequest{
			RouteIds: []string{"r1"},
		}, stream)
	}()

	// Give subscriber time to register.
	time.Sleep(10 * time.Millisecond)

	// Push 5 traces: 3 with route "r1", 2 with route "r2".
	for i := range 3 {
		buf.Push(makeTrace(
			fmt.Sprintf("w-r1-%d", i),
			now.Add(time.Duration(i)*time.Millisecond),
			200, "r1", "",
		))
	}
	for i := range 2 {
		buf.Push(makeTrace(
			fmt.Sprintf("w-r2-%d", i),
			now.Add(time.Duration(3+i)*time.Millisecond),
			200, "r2", "",
		))
	}

	// Wait briefly for stream sends to complete.
	time.Sleep(50 * time.Millisecond)

	// Cancel context to stop the stream.
	cancel()

	// Wait for WatchTraffic to return.
	if err := <-errCh; err != nil {
		t.Fatalf("WatchTraffic: %v", err)
	}

	// Verify only 3 traces (route "r1") were sent.
	got := stream.getTraces()
	if len(got) != 3 {
		t.Fatalf("len(traces) = %d, want 3", len(got))
	}
	for _, tr := range got {
		if tr.GetRouteId() != "r1" {
			t.Errorf("trace %q has route %q, want %q", tr.GetTraceId(), tr.GetRouteId(), "r1")
		}
	}
}
