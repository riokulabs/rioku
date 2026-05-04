package sqlite

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/tracestore"
)

// openTestDriver creates a fresh SQLite trace store driver using a temp directory.
func openTestDriver(t *testing.T) *driver {
	t.Helper()
	dir := t.TempDir()
	d := &driver{}
	err := d.Open(context.Background(), tracestore.DriverConfig{
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
		PolicyIds:  []string{"pol-1", "pol-2"},
		AuthResult: "pass",
	}
}

func TestSQLite_OpenClose(t *testing.T) {
	dir := t.TempDir()
	d := &driver{}
	ctx := context.Background()

	err := d.Open(ctx, tracestore.DriverConfig{
		Driver: "sqlite",
		Path:   filepath.Join(dir, "test.db"),
	})
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}

	if err := d.Close(); err != nil {
		t.Fatalf("Close failed: %v", err)
	}
}

func TestSQLite_WriteBatch(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	now := time.Now().UTC()
	traces := make([]*riokuv1.RequestTrace, 100)
	for i := range traces {
		traces[i] = makeTrace(
			fmt.Sprintf("trace-%03d", i),
			now.Add(time.Duration(i)*time.Second),
			200,
			"route-1",
			"",
		)
	}

	if err := d.WriteBatch(ctx, traces); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	// Verify count via QueryTraces with wide time window.
	q := &riokuv1.TraceQuery{
		Since: timestamppb.New(now.Add(-time.Hour)),
		Until: timestamppb.New(now.Add(time.Hour)),
		Page:  &riokuv1.PageRequest{PageSize: 200},
	}
	results, total, err := d.QueryTraces(ctx, q)
	if err != nil {
		t.Fatalf("QueryTraces: %v", err)
	}
	if total != 100 {
		t.Errorf("total = %d, want 100", total)
	}
	if len(results) != 100 {
		t.Errorf("len(results) = %d, want 100", len(results))
	}
}

func TestSQLite_QueryTraces(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	now := time.Now().UTC().Truncate(time.Millisecond)

	// Write traces with different statuses and routes.
	traces := []*riokuv1.RequestTrace{
		makeTrace("t-200-r1", now, 200, "route-1", ""),
		makeTrace("t-200-r2", now.Add(time.Second), 200, "route-2", ""),
		makeTrace("t-404-r1", now.Add(2*time.Second), 404, "route-1", ""),
		makeTrace("t-500-r2", now.Add(3*time.Second), 500, "route-2", ""),
		makeTrace("t-200-r1b", now.Add(4*time.Second), 200, "route-1", ""),
	}
	if err := d.WriteBatch(ctx, traces); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	// Sub-test: filter by status code.
	t.Run("ByStatus", func(t *testing.T) {
		q := &riokuv1.TraceQuery{
			StatusCodes: []int32{404},
			Page:        &riokuv1.PageRequest{PageSize: 50},
		}
		results, total, err := d.QueryTraces(ctx, q)
		if err != nil {
			t.Fatalf("QueryTraces: %v", err)
		}
		if total != 1 {
			t.Errorf("total = %d, want 1", total)
		}
		if len(results) != 1 {
			t.Errorf("len = %d, want 1", len(results))
		}
		if len(results) > 0 && results[0].GetTraceId() != "t-404-r1" {
			t.Errorf("trace_id = %q, want %q", results[0].GetTraceId(), "t-404-r1")
		}
	})

	// Sub-test: filter by route_id.
	t.Run("ByRouteID", func(t *testing.T) {
		q := &riokuv1.TraceQuery{
			RouteIds: []string{"route-2"},
			Page:     &riokuv1.PageRequest{PageSize: 50},
		}
		results, total, err := d.QueryTraces(ctx, q)
		if err != nil {
			t.Fatalf("QueryTraces: %v", err)
		}
		if total != 2 {
			t.Errorf("total = %d, want 2", total)
		}
		if len(results) != 2 {
			t.Errorf("len = %d, want 2", len(results))
		}
	})

	// Sub-test: filter by time range.
	t.Run("ByTimeRange", func(t *testing.T) {
		q := &riokuv1.TraceQuery{
			Since: timestamppb.New(now.Add(time.Second)),
			Until: timestamppb.New(now.Add(3 * time.Second)),
			Page:  &riokuv1.PageRequest{PageSize: 50},
		}
		results, total, err := d.QueryTraces(ctx, q)
		if err != nil {
			t.Fatalf("QueryTraces: %v", err)
		}
		// Should match t-200-r2 (1s), t-404-r1 (2s), t-500-r2 (3s).
		if total != 3 {
			t.Errorf("total = %d, want 3", total)
		}
		if len(results) != 3 {
			t.Errorf("len = %d, want 3", len(results))
		}
	})
}

func TestSQLite_GetTrace(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	now := time.Now().UTC().Truncate(time.Millisecond)
	tr := makeTrace("get-me", now, 201, "route-x", "sess-1")
	tr.Ai = &riokuv1.AITrace{
		Provider:         "openai",
		Model:            "gpt-4",
		InputTokens:      100,
		OutputTokens:     50,
		TotalTokens:      150,
		EstimatedCostUsd: 0.0042,
		IsStreaming:      true,
		FinishReason:     "stop",
	}

	if err := d.WriteBatch(ctx, []*riokuv1.RequestTrace{tr}); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	got, err := d.GetTrace(ctx, "get-me")
	if err != nil {
		t.Fatalf("GetTrace: %v", err)
	}
	if got == nil {
		t.Fatal("GetTrace returned nil")
	}
	if got.GetTraceId() != "get-me" {
		t.Errorf("trace_id = %q, want %q", got.GetTraceId(), "get-me")
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
	if got.GetBytesSent() != 1024 {
		t.Errorf("bytes_sent = %d, want 1024", got.GetBytesSent())
	}

	// AI fields.
	ai := got.GetAi()
	if ai == nil {
		t.Fatal("ai is nil")
	}
	if ai.GetProvider() != "openai" {
		t.Errorf("ai.provider = %q, want %q", ai.GetProvider(), "openai")
	}
	if ai.GetModel() != "gpt-4" {
		t.Errorf("ai.model = %q, want %q", ai.GetModel(), "gpt-4")
	}
	if ai.GetInputTokens() != 100 {
		t.Errorf("ai.input_tokens = %d, want 100", ai.GetInputTokens())
	}
	if ai.GetOutputTokens() != 50 {
		t.Errorf("ai.output_tokens = %d, want 50", ai.GetOutputTokens())
	}
	if ai.GetTotalTokens() != 150 {
		t.Errorf("ai.total_tokens = %d, want 150", ai.GetTotalTokens())
	}
	if ai.GetEstimatedCostUsd() != 0.0042 {
		t.Errorf("ai.estimated_cost_usd = %f, want 0.0042", ai.GetEstimatedCostUsd())
	}
	if !ai.GetIsStreaming() {
		t.Error("ai.is_streaming = false, want true")
	}
	if ai.GetFinishReason() != "stop" {
		t.Errorf("ai.finish_reason = %q, want %q", ai.GetFinishReason(), "stop")
	}

	// PolicyIds.
	pids := got.GetPolicyIds()
	if len(pids) != 2 || pids[0] != "pol-1" || pids[1] != "pol-2" {
		t.Errorf("policy_ids = %v, want [pol-1 pol-2]", pids)
	}

	// Not found returns nil.
	got2, err := d.GetTrace(ctx, "does-not-exist")
	if err != nil {
		t.Fatalf("GetTrace not-found: %v", err)
	}
	if got2 != nil {
		t.Errorf("expected nil for non-existent trace, got %v", got2)
	}
}

func TestSQLite_WriteAndReadStatsBuckets(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	for i := range 5 {
		b := tracestore.StatsBucket{
			BucketStart:  base.Add(time.Duration(i) * time.Minute),
			RequestCount: int64(100 + i),
			ErrorCount:   int64(i),
			P50LatencyMS: 10,
			P95LatencyMS: 50,
			P99LatencyMS: 100,
			BytesSent:    int64(1000 * (i + 1)),
			BytesRecv:    int64(500 * (i + 1)),
		}
		if err := d.WriteStatsBucket(ctx, b); err != nil {
			t.Fatalf("WriteStatsBucket(%d): %v", i, err)
		}
	}

	buckets, err := d.GetStatsBuckets(ctx, base, base.Add(4*time.Minute))
	if err != nil {
		t.Fatalf("GetStatsBuckets: %v", err)
	}
	if len(buckets) != 5 {
		t.Fatalf("len = %d, want 5", len(buckets))
	}
	if buckets[0].RequestCount != 100 {
		t.Errorf("buckets[0].RequestCount = %d, want 100", buckets[0].RequestCount)
	}
	if buckets[4].RequestCount != 104 {
		t.Errorf("buckets[4].RequestCount = %d, want 104", buckets[4].RequestCount)
	}
	if buckets[2].BytesSent != 3000 {
		t.Errorf("buckets[2].BytesSent = %d, want 3000", buckets[2].BytesSent)
	}
}

func TestSQLite_WriteAndReadRouteBuckets(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	routeBuckets := []tracestore.RouteBucket{
		{BucketStart: base, RouteID: "r-1", RequestCount: 50, ErrorCount: 2, AvgLatencyMS: 15},
		{BucketStart: base, RouteID: "r-2", RequestCount: 30, ErrorCount: 0, AvgLatencyMS: 25},
		{BucketStart: base.Add(time.Minute), RouteID: "r-1", RequestCount: 60, ErrorCount: 1, AvgLatencyMS: 12},
		{BucketStart: base.Add(time.Minute), RouteID: "r-2", RequestCount: 40, ErrorCount: 3, AvgLatencyMS: 30},
	}
	for i, b := range routeBuckets {
		if err := d.WriteRouteBucket(ctx, b); err != nil {
			t.Fatalf("WriteRouteBucket(%d): %v", i, err)
		}
	}

	results, err := d.GetRouteBuckets(ctx, base, base.Add(time.Minute))
	if err != nil {
		t.Fatalf("GetRouteBuckets: %v", err)
	}
	if len(results) != 4 {
		t.Fatalf("len = %d, want 4", len(results))
	}

	// Verify first bucket.
	if results[0].RouteID != "r-1" {
		t.Errorf("results[0].RouteID = %q, want %q", results[0].RouteID, "r-1")
	}
	if results[0].RequestCount != 50 {
		t.Errorf("results[0].RequestCount = %d, want 50", results[0].RequestCount)
	}
}

func TestSQLite_Prune(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	now := time.Now().UTC()
	old := now.Add(-8 * 24 * time.Hour) // 8 days ago

	var traces []*riokuv1.RequestTrace
	// 5 old traces.
	for i := range 5 {
		traces = append(traces, makeTrace(
			fmt.Sprintf("old-%d", i),
			old.Add(time.Duration(i)*time.Minute),
			200, "route-1", "",
		))
	}
	// 5 recent traces.
	for i := range 5 {
		traces = append(traces, makeTrace(
			fmt.Sprintf("new-%d", i),
			now.Add(-time.Duration(i)*time.Minute),
			200, "route-1", "",
		))
	}

	if err := d.WriteBatch(ctx, traces); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	// Also write some old aggregate buckets to prune.
	oldBucket := old.Truncate(time.Minute)
	if err := d.WriteStatsBucket(ctx, tracestore.StatsBucket{
		BucketStart:  oldBucket,
		RequestCount: 99,
	}); err != nil {
		t.Fatalf("WriteStatsBucket: %v", err)
	}

	deleted, err := d.Prune(ctx, 7*24*time.Hour, 7*24*time.Hour, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("Prune: %v", err)
	}
	// 5 old traces + 1 old stats bucket = 6 deleted.
	if deleted != 6 {
		t.Errorf("deleted = %d, want 6", deleted)
	}

	// Verify only recent traces remain.
	q := &riokuv1.TraceQuery{
		Page: &riokuv1.PageRequest{PageSize: 100},
	}
	results, total, err := d.QueryTraces(ctx, q)
	if err != nil {
		t.Fatalf("QueryTraces: %v", err)
	}
	if total != 5 {
		t.Errorf("total = %d, want 5", total)
	}
	if len(results) != 5 {
		t.Errorf("len = %d, want 5", len(results))
	}
}

func TestSQLite_WriteAndReadStatusBuckets(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	statusBuckets := []tracestore.StatusBucket{
		{BucketStart: base, StatusClass: "2xx", RequestCount: 80},
		{BucketStart: base, StatusClass: "4xx", RequestCount: 15},
		{BucketStart: base, StatusClass: "5xx", RequestCount: 5},
		{BucketStart: base.Add(time.Minute), StatusClass: "2xx", RequestCount: 90},
		{BucketStart: base.Add(time.Minute), StatusClass: "4xx", RequestCount: 8},
	}
	for i, b := range statusBuckets {
		if err := d.WriteStatusBucket(ctx, b); err != nil {
			t.Fatalf("WriteStatusBucket(%d): %v", i, err)
		}
	}

	results, err := d.GetStatusBuckets(ctx, base, base.Add(time.Minute))
	if err != nil {
		t.Fatalf("GetStatusBuckets: %v", err)
	}
	if len(results) != 5 {
		t.Fatalf("len = %d, want 5", len(results))
	}

	// First bucket should be base/2xx.
	if results[0].StatusClass != "2xx" {
		t.Errorf("results[0].StatusClass = %q, want %q", results[0].StatusClass, "2xx")
	}
	if results[0].RequestCount != 80 {
		t.Errorf("results[0].RequestCount = %d, want 80", results[0].RequestCount)
	}
	// Verify the 5xx bucket is present.
	found5xx := false
	for _, b := range results {
		if b.StatusClass == "5xx" && b.RequestCount == 5 {
			found5xx = true
		}
	}
	if !found5xx {
		t.Error("5xx bucket with count 5 not found in results")
	}
}

func TestSQLite_GetStatusBuckets_TimeRange(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	// Write buckets at minute 0, 1, 2, 3.
	for i := range 4 {
		b := tracestore.StatusBucket{
			BucketStart:  base.Add(time.Duration(i) * time.Minute),
			StatusClass:  "2xx",
			RequestCount: int64(10 + i),
		}
		if err := d.WriteStatusBucket(ctx, b); err != nil {
			t.Fatalf("WriteStatusBucket(%d): %v", i, err)
		}
	}

	// Query only minutes 1 and 2.
	results, err := d.GetStatusBuckets(ctx, base.Add(time.Minute), base.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("GetStatusBuckets: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("len = %d, want 2", len(results))
	}
	if results[0].RequestCount != 11 {
		t.Errorf("results[0].RequestCount = %d, want 11", results[0].RequestCount)
	}
	if results[1].RequestCount != 12 {
		t.Errorf("results[1].RequestCount = %d, want 12", results[1].RequestCount)
	}
}

func TestSQLite_GetStatusBuckets_Empty(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	results, err := d.GetStatusBuckets(ctx, base, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("GetStatusBuckets empty: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("len = %d, want 0", len(results))
	}
}

func TestSQLite_WriteAndReadModelBuckets(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	modelBuckets := []tracestore.ModelBucket{
		{BucketStart: base, Provider: "openai", Model: "gpt-4", RequestCount: 20, TotalTokens: 5000, EstimatedCostUSD: 0.15},
		{BucketStart: base, Provider: "openai", Model: "gpt-3.5-turbo", RequestCount: 50, TotalTokens: 8000, EstimatedCostUSD: 0.008},
		{BucketStart: base, Provider: "anthropic", Model: "claude-3", RequestCount: 10, TotalTokens: 2000, EstimatedCostUSD: 0.06},
		{BucketStart: base.Add(time.Minute), Provider: "openai", Model: "gpt-4", RequestCount: 25, TotalTokens: 6000, EstimatedCostUSD: 0.18},
	}
	for i, b := range modelBuckets {
		if err := d.WriteModelBucket(ctx, b); err != nil {
			t.Fatalf("WriteModelBucket(%d): %v", i, err)
		}
	}

	results, err := d.GetModelBuckets(ctx, base, base.Add(time.Minute))
	if err != nil {
		t.Fatalf("GetModelBuckets: %v", err)
	}
	if len(results) != 4 {
		t.Fatalf("len = %d, want 4", len(results))
	}

	// Find the gpt-4 bucket at base.
	var gpt4 *tracestore.ModelBucket
	for i := range results {
		if results[i].Provider == "openai" && results[i].Model == "gpt-4" && results[i].RequestCount == 20 {
			gpt4 = &results[i]
			break
		}
	}
	if gpt4 == nil {
		t.Fatal("gpt-4 bucket (count=20) not found")
		return
	}
	if gpt4.TotalTokens != 5000 {
		t.Errorf("gpt4.TotalTokens = %d, want 5000", gpt4.TotalTokens)
	}
	if gpt4.EstimatedCostUSD != 0.15 {
		t.Errorf("gpt4.EstimatedCostUSD = %f, want 0.15", gpt4.EstimatedCostUSD)
	}
}

func TestSQLite_GetModelBuckets_TimeRange(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)

	// Write buckets at minute 0, 1, 2, 3.
	for i := range 4 {
		b := tracestore.ModelBucket{
			BucketStart:  base.Add(time.Duration(i) * time.Minute),
			Provider:     "openai",
			Model:        "gpt-4",
			RequestCount: int64(5 + i),
			TotalTokens:  int64(1000 * (i + 1)),
		}
		if err := d.WriteModelBucket(ctx, b); err != nil {
			t.Fatalf("WriteModelBucket(%d): %v", i, err)
		}
	}

	// Query only minutes 1 and 2.
	results, err := d.GetModelBuckets(ctx, base.Add(time.Minute), base.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("GetModelBuckets: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("len = %d, want 2", len(results))
	}
	if results[0].RequestCount != 6 {
		t.Errorf("results[0].RequestCount = %d, want 6", results[0].RequestCount)
	}
	if results[1].TotalTokens != 3000 {
		t.Errorf("results[1].TotalTokens = %d, want 3000", results[1].TotalTokens)
	}
}

func TestSQLite_GetModelBuckets_Empty(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	base := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	results, err := d.GetModelBuckets(ctx, base, base.Add(time.Hour))
	if err != nil {
		t.Fatalf("GetModelBuckets empty: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("len = %d, want 0", len(results))
	}
}

func TestSQLite_GetSessionTraces(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	now := time.Now().UTC()

	traces := []*riokuv1.RequestTrace{
		makeTrace("sess-t1", now, 200, "route-1", "session-xyz"),
		makeTrace("sess-t2", now.Add(time.Second), 201, "route-2", "session-xyz"),
		makeTrace("sess-t3", now.Add(2*time.Second), 500, "route-1", "session-xyz"),
		makeTrace("other-t1", now.Add(3*time.Second), 200, "route-1", "session-other"),
		makeTrace("no-sess", now.Add(4*time.Second), 200, "route-1", ""),
	}
	if err := d.WriteBatch(ctx, traces); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	results, err := d.GetSessionTraces(ctx, "session-xyz")
	if err != nil {
		t.Fatalf("GetSessionTraces: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("len = %d, want 3", len(results))
	}

	// Results are ordered by started_at ASC.
	if results[0].GetTraceId() != "sess-t1" {
		t.Errorf("results[0].TraceId = %q, want %q", results[0].GetTraceId(), "sess-t1")
	}
	if results[1].GetTraceId() != "sess-t2" {
		t.Errorf("results[1].TraceId = %q, want %q", results[1].GetTraceId(), "sess-t2")
	}
	if results[2].GetTraceId() != "sess-t3" {
		t.Errorf("results[2].TraceId = %q, want %q", results[2].GetTraceId(), "sess-t3")
	}
	if results[2].GetStatusCode() != 500 {
		t.Errorf("results[2].StatusCode = %d, want 500", results[2].GetStatusCode())
	}
	// Verify session_id is correctly stored.
	for _, tr := range results {
		if tr.GetSessionId() != "session-xyz" {
			t.Errorf("session_id = %q, want %q", tr.GetSessionId(), "session-xyz")
		}
	}
}

func TestSQLite_GetSessionTraces_NoMatches(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	now := time.Now().UTC()
	traces := []*riokuv1.RequestTrace{
		makeTrace("t1", now, 200, "route-1", "session-alpha"),
	}
	if err := d.WriteBatch(ctx, traces); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	results, err := d.GetSessionTraces(ctx, "session-does-not-exist")
	if err != nil {
		t.Fatalf("GetSessionTraces: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("len = %d, want 0", len(results))
	}
}

func TestSQLite_ListSessions(t *testing.T) {
	d := openTestDriver(t)
	ctx := context.Background()

	now := time.Now().UTC()

	traces := []*riokuv1.RequestTrace{
		makeTrace("s1-t1", now, 200, "route-1", "session-alpha"),
		makeTrace("s1-t2", now.Add(time.Second), 200, "route-1", "session-alpha"),
		makeTrace("s1-t3", now.Add(2*time.Second), 200, "route-1", "session-alpha"),
		makeTrace("s2-t1", now.Add(3*time.Second), 200, "route-2", "session-beta"),
		makeTrace("s2-t2", now.Add(4*time.Second), 200, "route-2", "session-beta"),
		makeTrace("no-session", now.Add(5*time.Second), 200, "route-1", ""), // no session
	}
	// Add AI fields to session traces so token/cost sums are non-zero.
	for _, tr := range traces[:5] {
		tr.Ai = &riokuv1.AITrace{
			Provider:         "openai",
			Model:            "gpt-4",
			TotalTokens:      100,
			EstimatedCostUsd: 0.01,
		}
	}

	if err := d.WriteBatch(ctx, traces); err != nil {
		t.Fatalf("WriteBatch: %v", err)
	}

	sessions, total, err := d.ListSessions(ctx, false, time.Time{}, 50, 0)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if total != 2 {
		t.Errorf("total = %d, want 2", total)
	}
	if len(sessions) != 2 {
		t.Errorf("len = %d, want 2", len(sessions))
	}

	// Check turn counts. Sessions are ordered by last_seen DESC by default,
	// so session-beta (later start) comes first.
	found := map[string]int64{}
	for _, s := range sessions {
		found[s.SessionID] = s.TurnCount
	}
	if found["session-alpha"] != 3 {
		t.Errorf("session-alpha turns = %d, want 3", found["session-alpha"])
	}
	if found["session-beta"] != 2 {
		t.Errorf("session-beta turns = %d, want 2", found["session-beta"])
	}
}
