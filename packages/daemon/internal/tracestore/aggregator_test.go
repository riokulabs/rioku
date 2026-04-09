package tracestore

import (
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
