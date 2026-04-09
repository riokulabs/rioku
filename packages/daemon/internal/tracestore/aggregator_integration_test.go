// Package tracestore_test provides integration tests for the aggregator that
// require a real SQLite backend. These tests live in an external test package
// to avoid a circular import between tracestore and tracestore/sqlite.
package tracestore_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/tracestore"
	_ "github.com/riokulabs/rioku/internal/tracestore/sqlite"
)

// TestAggregator_RunCycle pushes 50 traces to a real ring buffer, runs one
// aggregation cycle against a real SQLite store, and reads back the written buckets.
func TestAggregator_RunCycle(t *testing.T) {
	ctx := context.Background()

	drv, err := tracestore.New("sqlite")
	if err != nil {
		t.Fatalf("New sqlite driver: %v", err)
	}
	if err := drv.Open(ctx, tracestore.DriverConfig{
		Path: filepath.Join(t.TempDir(), "test.db"),
	}); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = drv.Close() })

	rb := tracestore.NewRingBuffer(1000)

	// Push 50 traces with varying status codes and latencies.
	// lastAggregated defaults to zero time, so DrainSince will return all traces.
	base := time.Now().Add(-time.Minute)
	for i := 0; i < 50; i++ {
		status := int32(200)
		if i >= 45 {
			status = 500
		}
		tr := &riokuv1.RequestTrace{
			TraceId:    "t" + string(rune('0'+i%10)),
			StartedAt:  timestamppb.New(base.Add(time.Duration(i) * time.Millisecond)),
			DurationMs: int64(i + 1),
			StatusCode: status,
			RouteId:    "route-test",
			BytesSent:  100,
			BytesRecv:  50,
		}
		rb.Push(tr)
	}

	agg := tracestore.NewAggregator(rb, drv, time.Minute)

	if err := agg.RunCycle(ctx); err != nil {
		t.Fatalf("RunCycle: %v", err)
	}

	// Read back stats buckets.
	since := time.Now().Add(-2 * time.Minute)
	until := time.Now().Add(time.Minute)

	statsBuckets, err := drv.GetStatsBuckets(ctx, since, until)
	if err != nil {
		t.Fatalf("GetStatsBuckets: %v", err)
	}
	if len(statsBuckets) == 0 {
		t.Fatal("expected at least one stats bucket, got none")
	}
	sb := statsBuckets[0]
	if sb.RequestCount != 50 {
		t.Errorf("RequestCount = %d, want 50", sb.RequestCount)
	}
	if sb.ErrorCount != 5 {
		t.Errorf("ErrorCount = %d, want 5", sb.ErrorCount)
	}
	if sb.P50LatencyMS == 0 {
		t.Error("P50LatencyMS = 0, expected non-zero")
	}

	// Read back route buckets.
	routeBuckets, err := drv.GetRouteBuckets(ctx, since, until)
	if err != nil {
		t.Fatalf("GetRouteBuckets: %v", err)
	}
	if len(routeBuckets) == 0 {
		t.Fatal("expected at least one route bucket, got none")
	}
	if routeBuckets[0].RequestCount != 50 {
		t.Errorf("route RequestCount = %d, want 50", routeBuckets[0].RequestCount)
	}

	// Read back status buckets.
	statusBuckets, err := drv.GetStatusBuckets(ctx, since, until)
	if err != nil {
		t.Fatalf("GetStatusBuckets: %v", err)
	}
	if len(statusBuckets) == 0 {
		t.Fatal("expected at least one status bucket, got none")
	}

	byClass := make(map[string]int64)
	for _, b := range statusBuckets {
		byClass[b.StatusClass] += b.RequestCount
	}
	if byClass["2xx"] != 45 {
		t.Errorf("2xx count = %d, want 45", byClass["2xx"])
	}
	if byClass["5xx"] != 5 {
		t.Errorf("5xx count = %d, want 5", byClass["5xx"])
	}
}
