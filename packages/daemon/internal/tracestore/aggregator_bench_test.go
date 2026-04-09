package tracestore_test

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/tracestore"
	_ "github.com/riokulabs/rioku/internal/tracestore/sqlite"
)

// benchTraceAgg generates a realistic *riokuv1.RequestTrace for aggregator benchmarks.
// Every 10th trace (i%10 == 0) gets status 500; the rest get 200.
func benchTraceAgg(i int) *riokuv1.RequestTrace {
	status := int32(200)
	if i%10 == 0 {
		status = 500
	}
	return &riokuv1.RequestTrace{
		TraceId:    uuid.New().String(),
		Method:     "GET",
		Path:       "/api/v1/test",
		Host:       "bench.local",
		StatusCode: status,
		DurationMs: int64(i % 100),
		StartedAt:  timestamppb.New(time.Now()),
		RouteId:    fmt.Sprintf("route-%d", i%50),
		BytesSent:  1024,
	}
}

// makeBenchTraces builds a slice of n traces for use in aggregator benchmarks.
func makeBenchTraces(n int) []*riokuv1.RequestTrace {
	traces := make([]*riokuv1.RequestTrace, n)
	for i := range traces {
		traces[i] = benchTraceAgg(i)
	}
	return traces
}

// BenchmarkComputeStatsBucket benchmarks ComputeStatsBucket with 10K traces.
// Target: <10ms.
func BenchmarkComputeStatsBucket(b *testing.B) {
	const n = 10_000
	traces := makeBenchTraces(n)
	bucketStart := time.Now().Truncate(time.Minute)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = tracestore.ComputeStatsBucket(traces, bucketStart)
	}
}

// BenchmarkComputeRouteBuckets benchmarks ComputeRouteBuckets with 10K traces
// spread across 50 routes.
func BenchmarkComputeRouteBuckets(b *testing.B) {
	const n = 10_000
	traces := makeBenchTraces(n) // route IDs cycle through route-0..route-49
	bucketStart := time.Now().Truncate(time.Minute)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = tracestore.ComputeRouteBuckets(traces, bucketStart)
	}
}

// BenchmarkAggregatorCycle benchmarks a full aggregation cycle: push traces into
// a real ring buffer, then run one RunCycle against a real SQLite store.
func BenchmarkAggregatorCycle(b *testing.B) {
	ctx := context.Background()

	b.StopTimer()
	drv, err := tracestore.New("sqlite")
	if err != nil {
		b.Fatalf("tracestore.New: %v", err)
	}
	if err := drv.Open(ctx, tracestore.DriverConfig{
		Path: filepath.Join(b.TempDir(), "agg_cycle.db"),
	}); err != nil {
		b.Fatalf("Open: %v", err)
	}
	b.Cleanup(func() { _ = drv.Close() })

	const tracesPerCycle = 1000
	rb := tracestore.NewRingBuffer(tracesPerCycle * 2)
	agg := tracestore.NewAggregator(rb, drv, time.Minute)

	b.ReportAllocs()
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		b.StopTimer()
		// Refill the ring buffer for each cycle.
		base := time.Now().Add(-time.Minute)
		for j := 0; j < tracesPerCycle; j++ {
			tr := benchTraceAgg(j)
			tr.StartedAt = timestamppb.New(base.Add(time.Duration(j) * time.Millisecond))
			rb.Push(tr)
		}
		b.StartTimer()

		if err := agg.RunCycle(ctx); err != nil {
			b.Fatal(err)
		}
	}
}
