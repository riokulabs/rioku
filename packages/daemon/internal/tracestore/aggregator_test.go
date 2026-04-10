package tracestore

import (
	"context"
	"sort"
	"testing"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// makeAggTrace builds a RequestTrace with the given duration, status code, route, and optional AI trace.
func makeAggTrace(durationMS int64, statusCode int32, routeID string, ai *riokuv1.AITrace) *riokuv1.RequestTrace {
	return &riokuv1.RequestTrace{
		TraceId:    "trace",
		StartedAt:  timestamppb.Now(),
		DurationMs: durationMS,
		StatusCode: statusCode,
		RouteId:    routeID,
		BytesSent:  100,
		BytesRecv:  50,
		Ai:         ai,
	}
}

// TestAggregator_ComputeStatsBucket feeds 100 traces with latencies 1ms..100ms
// and verifies percentile and error count calculations.
func TestAggregator_ComputeStatsBucket(t *testing.T) {
	now := time.Now()
	traces := make([]*riokuv1.RequestTrace, 100)
	// Latencies: 1ms, 2ms, ..., 100ms
	// Errors: status >= 500 → traces at index 95..99 → latencies 96..100ms → 5 errors
	for i := 0; i < 100; i++ {
		status := int32(200)
		if i >= 95 {
			status = 500
		}
		traces[i] = makeAggTrace(int64(i+1), status, "route-a", nil)
	}

	bucket := ComputeStatsBucket(traces, now)

	if bucket.RequestCount != 100 {
		t.Errorf("RequestCount = %d, want 100", bucket.RequestCount)
	}
	if bucket.ErrorCount != 5 {
		t.Errorf("ErrorCount = %d, want 5", bucket.ErrorCount)
	}
	if bucket.P50LatencyMS != 50 {
		t.Errorf("P50LatencyMS = %d, want 50", bucket.P50LatencyMS)
	}
	if bucket.P95LatencyMS != 95 {
		t.Errorf("P95LatencyMS = %d, want 95", bucket.P95LatencyMS)
	}
	if bucket.P99LatencyMS != 99 {
		t.Errorf("P99LatencyMS = %d, want 99", bucket.P99LatencyMS)
	}
	if bucket.BucketStart != now {
		t.Errorf("BucketStart = %v, want %v", bucket.BucketStart, now)
	}
}

// TestAggregator_ComputeRouteBuckets verifies per-route request counts and average latency.
func TestAggregator_ComputeRouteBuckets(t *testing.T) {
	now := time.Now()
	var traces []*riokuv1.RequestTrace

	// route-a: 20 traces, all 10ms
	for i := 0; i < 20; i++ {
		traces = append(traces, makeAggTrace(10, 200, "route-a", nil))
	}
	// route-b: 30 traces, all 20ms
	for i := 0; i < 30; i++ {
		traces = append(traces, makeAggTrace(20, 200, "route-b", nil))
	}
	// route-c: 50 traces, all 30ms; last 5 are errors
	for i := 0; i < 50; i++ {
		status := int32(200)
		if i >= 45 {
			status = 500
		}
		traces = append(traces, makeAggTrace(30, status, "route-c", nil))
	}

	buckets := ComputeRouteBuckets(traces, now)

	// Sort by RouteID for deterministic assertions.
	sort.Slice(buckets, func(i, j int) bool { return buckets[i].RouteID < buckets[j].RouteID })

	if len(buckets) != 3 {
		t.Fatalf("len(buckets) = %d, want 3", len(buckets))
	}

	tests := []struct {
		route        string
		wantCount    int64
		wantErrors   int64
		wantAvgLatMS int64
	}{
		{"route-a", 20, 0, 10},
		{"route-b", 30, 0, 20},
		{"route-c", 50, 5, 30},
	}

	for i, tt := range tests {
		b := buckets[i]
		if b.RouteID != tt.route {
			t.Errorf("buckets[%d].RouteID = %q, want %q", i, b.RouteID, tt.route)
		}
		if b.RequestCount != tt.wantCount {
			t.Errorf("buckets[%d].RequestCount = %d, want %d", i, b.RequestCount, tt.wantCount)
		}
		if b.ErrorCount != tt.wantErrors {
			t.Errorf("buckets[%d].ErrorCount = %d, want %d", i, b.ErrorCount, tt.wantErrors)
		}
		if b.AvgLatencyMS != tt.wantAvgLatMS {
			t.Errorf("buckets[%d].AvgLatencyMS = %d, want %d", i, b.AvgLatencyMS, tt.wantAvgLatMS)
		}
		if b.BucketStart != now {
			t.Errorf("buckets[%d].BucketStart = %v, want %v", i, b.BucketStart, now)
		}
	}
}

// TestAggregator_ComputeStatusBuckets verifies status class aggregation.
func TestAggregator_ComputeStatusBuckets(t *testing.T) {
	now := time.Now()
	var traces []*riokuv1.RequestTrace

	// 60 × 200, 20 × 404, 20 × 500
	for i := 0; i < 60; i++ {
		traces = append(traces, makeAggTrace(10, 200, "r", nil))
	}
	for i := 0; i < 20; i++ {
		traces = append(traces, makeAggTrace(10, 404, "r", nil))
	}
	for i := 0; i < 20; i++ {
		traces = append(traces, makeAggTrace(10, 500, "r", nil))
	}

	buckets := ComputeStatusBuckets(traces, now)

	// Index by class for stable assertions.
	byClass := make(map[string]int64)
	for _, b := range buckets {
		byClass[b.StatusClass] = b.RequestCount
		if b.BucketStart != now {
			t.Errorf("BucketStart = %v, want %v", b.BucketStart, now)
		}
	}

	wantCounts := map[string]int64{
		"2xx": 60,
		"4xx": 20,
		"5xx": 20,
	}
	for class, want := range wantCounts {
		got := byClass[class]
		if got != want {
			t.Errorf("status class %q count = %d, want %d", class, got, want)
		}
	}
}

// noopDriver is a minimal Driver stub that records write calls for unit tests.
type noopDriver struct{}

func (n *noopDriver) Open(_ context.Context, _ DriverConfig) error { return nil }
func (n *noopDriver) Close() error                                 { return nil }
func (n *noopDriver) WriteBatch(_ context.Context, _ []*riokuv1.RequestTrace) error {
	return nil
}
func (n *noopDriver) WriteStatsBucket(_ context.Context, _ StatsBucket) error   { return nil }
func (n *noopDriver) WriteRouteBucket(_ context.Context, _ RouteBucket) error   { return nil }
func (n *noopDriver) WriteStatusBucket(_ context.Context, _ StatusBucket) error { return nil }
func (n *noopDriver) WriteModelBucket(_ context.Context, _ ModelBucket) error   { return nil }
func (n *noopDriver) QueryTraces(_ context.Context, _ *riokuv1.TraceQuery) ([]*riokuv1.RequestTrace, int64, error) {
	return nil, 0, nil
}
func (n *noopDriver) GetTrace(_ context.Context, _ string) (*riokuv1.RequestTrace, error) {
	return nil, nil
}
func (n *noopDriver) GetStatsBuckets(_ context.Context, _, _ time.Time) ([]StatsBucket, error) {
	return nil, nil
}
func (n *noopDriver) GetRouteBuckets(_ context.Context, _, _ time.Time) ([]RouteBucket, error) {
	return nil, nil
}
func (n *noopDriver) GetStatusBuckets(_ context.Context, _, _ time.Time) ([]StatusBucket, error) {
	return nil, nil
}
func (n *noopDriver) GetModelBuckets(_ context.Context, _, _ time.Time) ([]ModelBucket, error) {
	return nil, nil
}
func (n *noopDriver) GetSessionTraces(_ context.Context, _ string) ([]*riokuv1.RequestTrace, error) {
	return nil, nil
}
func (n *noopDriver) ListSessions(_ context.Context, _ bool, _ time.Time, _, _ int) ([]SessionSummary, int64, error) {
	return nil, 0, nil
}
func (n *noopDriver) Prune(_ context.Context, _, _, _ time.Duration) (int64, error) {
	return 0, nil
}

// TestAggregator_StartStop verifies Start launches a goroutine and Stop
// terminates it cleanly without hanging.
func TestAggregator_StartStop(t *testing.T) {
	rb := NewRingBuffer(8)
	agg := NewAggregator(rb, &noopDriver{}, 10*time.Millisecond)
	ctx := context.Background()
	agg.Start(ctx)
	// Push a trace so the first tick does real work.
	rb.Push(makeAggTrace(1, 200, "r", nil))
	time.Sleep(30 * time.Millisecond) // let at least one cycle fire
	agg.Stop()
	// Calling Stop a second time must not panic.
	agg.Stop()
}

// TestAggregator_ComputeStatsBucket_Empty covers the early-return path when
// no traces are provided.
func TestAggregator_ComputeStatsBucket_Empty(t *testing.T) {
	now := time.Now()
	b := ComputeStatsBucket(nil, now)
	if b.BucketStart != now {
		t.Errorf("BucketStart = %v, want %v", b.BucketStart, now)
	}
	if b.RequestCount != 0 {
		t.Errorf("RequestCount = %d, want 0", b.RequestCount)
	}
}

// TestAggregator_Percentile tests the Percentile helper on a known sorted slice.
func TestAggregator_Percentile(t *testing.T) {
	sorted := make([]int64, 100)
	for i := range sorted {
		sorted[i] = int64(i + 1) // 1..100
	}

	tests := []struct {
		p    float64
		want int64
	}{
		{0.50, 50},
		{0.95, 95},
		{0.99, 99},
	}
	for _, tt := range tests {
		got := Percentile(sorted, tt.p)
		if got != tt.want {
			t.Errorf("Percentile(%v) = %d, want %d", tt.p, got, tt.want)
		}
	}
}

// TestAggregator_Percentile_EdgeCases covers the empty-slice and clamp paths.
func TestAggregator_Percentile_EdgeCases(t *testing.T) {
	// Empty slice returns 0.
	if got := Percentile(nil, 0.99); got != 0 {
		t.Errorf("Percentile(nil, 0.99) = %d, want 0", got)
	}
	// Single-element slice: idx clamp to 0 when p rounds negative.
	if got := Percentile([]int64{42}, 0.0); got != 42 {
		t.Errorf("Percentile([42], 0.0) = %d, want 42", got)
	}
	// idx >= n clamp: p > 1.0 clamps to last element.
	if got := Percentile([]int64{1, 2, 3}, 2.0); got != 3 {
		t.Errorf("Percentile([1,2,3], 2.0) = %d, want 3", got)
	}
}

// TestAggregator_StatusClass covers 1xx, 3xx and the default case.
func TestAggregator_StatusClass(t *testing.T) {
	tests := []struct {
		code int32
		want string
	}{
		{100, "1xx"},
		{301, "3xx"},
		{0, "other"},
	}
	for _, tt := range tests {
		got := statusClass(tt.code)
		if got != tt.want {
			t.Errorf("statusClass(%d) = %q, want %q", tt.code, got, tt.want)
		}
	}
}

// TestAggregator_ComputeModelBuckets covers the ai != nil path.
func TestAggregator_ComputeModelBuckets(t *testing.T) {
	now := time.Now()
	traces := []*riokuv1.RequestTrace{
		makeAggTrace(10, 200, "r", &riokuv1.AITrace{
			Provider:         "openai",
			Model:            "gpt-4",
			TotalTokens:      500,
			EstimatedCostUsd: 0.01,
		}),
		makeAggTrace(10, 200, "r", &riokuv1.AITrace{
			Provider:         "openai",
			Model:            "gpt-4",
			TotalTokens:      300,
			EstimatedCostUsd: 0.006,
		}),
		makeAggTrace(10, 200, "r", nil), // no AI — should be skipped
	}

	buckets := ComputeModelBuckets(traces, now)
	if len(buckets) != 1 {
		t.Fatalf("expected 1 model bucket, got %d", len(buckets))
	}
	b := buckets[0]
	if b.Provider != "openai" {
		t.Errorf("Provider = %q, want openai", b.Provider)
	}
	if b.Model != "gpt-4" {
		t.Errorf("Model = %q, want gpt-4", b.Model)
	}
	if b.RequestCount != 2 {
		t.Errorf("RequestCount = %d, want 2", b.RequestCount)
	}
	if b.TotalTokens != 800 {
		t.Errorf("TotalTokens = %d, want 800", b.TotalTokens)
	}
}
