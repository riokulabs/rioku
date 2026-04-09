package sqlite_test

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

// benchTrace generates a realistic *riokuv1.RequestTrace for SQLite benchmarks.
// Every 10th trace (i%10 == 0) gets status 500; the rest get 200.
func benchTrace(i int) *riokuv1.RequestTrace {
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

// openBenchDriver opens a fresh SQLite tracestore driver in b.TempDir().
func openBenchDriver(b *testing.B) tracestore.Driver {
	b.Helper()
	ctx := context.Background()
	drv, err := tracestore.New("sqlite")
	if err != nil {
		b.Fatalf("tracestore.New: %v", err)
	}
	if err := drv.Open(ctx, tracestore.DriverConfig{
		Path: filepath.Join(b.TempDir(), "bench.db"),
	}); err != nil {
		b.Fatalf("Open: %v", err)
	}
	b.Cleanup(func() { _ = drv.Close() })
	return drv
}

// BenchmarkSQLiteWriteBatch_100 benchmarks batched inserts of 100 traces per op.
// Target: >10K traces/sec.
func BenchmarkSQLiteWriteBatch_100(b *testing.B) {
	drv := openBenchDriver(b)
	ctx := context.Background()

	const batchSize = 100
	batch := make([]*riokuv1.RequestTrace, batchSize)
	for i := range batch {
		batch[i] = benchTrace(i)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Regenerate unique trace IDs each iteration to avoid INSERT OR IGNORE skips.
		for j := range batch {
			batch[j] = benchTrace(i*batchSize + j)
		}
		if err := drv.WriteBatch(ctx, batch); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSQLiteWriteBatch_1000 benchmarks batched inserts of 1000 traces per op.
func BenchmarkSQLiteWriteBatch_1000(b *testing.B) {
	drv := openBenchDriver(b)
	ctx := context.Background()

	const batchSize = 1000
	batch := make([]*riokuv1.RequestTrace, batchSize)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for j := range batch {
			batch[j] = benchTrace(i*batchSize + j)
		}
		if err := drv.WriteBatch(ctx, batch); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSQLiteQueryTraces_TimeRange pre-populates 100K rows then benchmarks
// a time-range query. Target: <200ms per query.
func BenchmarkSQLiteQueryTraces_TimeRange(b *testing.B) {
	drv := openBenchDriver(b)
	ctx := context.Background()

	b.StopTimer()
	const rows = 100_000
	const insertBatch = 1000
	base := time.Now().Add(-time.Duration(rows) * time.Millisecond)
	for start := 0; start < rows; start += insertBatch {
		batch := make([]*riokuv1.RequestTrace, insertBatch)
		for j := range batch {
			tr := benchTrace(start + j)
			tr.StartedAt = timestamppb.New(base.Add(time.Duration(start+j) * time.Millisecond))
			batch[j] = tr
		}
		if err := drv.WriteBatch(ctx, batch); err != nil {
			b.Fatalf("WriteBatch setup: %v", err)
		}
	}

	since := base.Add(time.Duration(rows/4) * time.Millisecond)
	until := base.Add(time.Duration(rows*3/4) * time.Millisecond)
	q := &riokuv1.TraceQuery{
		Since: timestamppb.New(since),
		Until: timestamppb.New(until),
		Page:  &riokuv1.PageRequest{PageSize: 100},
	}

	b.ReportAllocs()
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		_, _, err := drv.QueryTraces(ctx, q)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSQLiteGetTrace pre-populates 100K rows then benchmarks PK lookup.
// Target: <1ms per lookup.
func BenchmarkSQLiteGetTrace(b *testing.B) {
	drv := openBenchDriver(b)
	ctx := context.Background()

	b.StopTimer()
	const rows = 100_000
	const insertBatch = 1000
	// Track the last inserted trace ID so we always look up a real row.
	var lastID string
	for start := 0; start < rows; start += insertBatch {
		batch := make([]*riokuv1.RequestTrace, insertBatch)
		for j := range batch {
			batch[j] = benchTrace(start + j)
		}
		lastID = batch[len(batch)-1].GetTraceId()
		if err := drv.WriteBatch(ctx, batch); err != nil {
			b.Fatalf("WriteBatch setup: %v", err)
		}
	}

	b.ReportAllocs()
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		_, err := drv.GetTrace(ctx, lastID)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSQLiteGetStatsBuckets writes 1440 stats buckets (24h at 1 per minute)
// then benchmarks reading them all back. Target: <10ms per read.
func BenchmarkSQLiteGetStatsBuckets(b *testing.B) {
	drv := openBenchDriver(b)
	ctx := context.Background()

	b.StopTimer()
	const numBuckets = 1440 // 24 hours × 60 minutes
	base := time.Now().UTC().Truncate(time.Minute).Add(-time.Duration(numBuckets) * time.Minute)
	for i := 0; i < numBuckets; i++ {
		bucket := tracestore.StatsBucket{
			BucketStart:  base.Add(time.Duration(i) * time.Minute),
			RequestCount: int64(100 + i%50),
			ErrorCount:   int64(i % 5),
			P50LatencyMS: 20,
			P95LatencyMS: 80,
			P99LatencyMS: 150,
			BytesSent:    int64(1024 * (i + 1)),
			BytesRecv:    int64(512 * (i + 1)),
		}
		if err := drv.WriteStatsBucket(ctx, bucket); err != nil {
			b.Fatalf("WriteStatsBucket: %v", err)
		}
	}

	since := base
	until := base.Add(time.Duration(numBuckets) * time.Minute)

	b.ReportAllocs()
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		_, err := drv.GetStatsBuckets(ctx, since, until)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSQLitePrune pre-populates 10K rows then benchmarks Prune.
// b.StopTimer is used to reset data between iterations.
func BenchmarkSQLitePrune(b *testing.B) {
	ctx := context.Background()
	const rows = 10_000
	const insertBatch = 1000

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		b.StopTimer()

		// Fresh driver for each iteration so Prune always has rows to delete.
		drv, err := tracestore.New("sqlite")
		if err != nil {
			b.Fatal(err)
		}
		if err := drv.Open(ctx, tracestore.DriverConfig{
			Path: filepath.Join(b.TempDir(), fmt.Sprintf("prune-%d.db", i)),
		}); err != nil {
			b.Fatal(err)
		}

		// Insert old rows (8 days ago) to ensure Prune deletes them.
		old := time.Now().UTC().Add(-8 * 24 * time.Hour)
		for start := 0; start < rows; start += insertBatch {
			batch := make([]*riokuv1.RequestTrace, insertBatch)
			for j := range batch {
				tr := benchTrace(start + j)
				tr.StartedAt = timestamppb.New(old.Add(time.Duration(start+j) * time.Millisecond))
				batch[j] = tr
			}
			if err := drv.WriteBatch(ctx, batch); err != nil {
				_ = drv.Close()
				b.Fatalf("WriteBatch setup: %v", err)
			}
		}

		b.StartTimer()
		_, err = drv.Prune(ctx, 7*24*time.Hour, 7*24*time.Hour, 7*24*time.Hour)
		b.StopTimer()

		if err != nil {
			_ = drv.Close()
			b.Fatalf("Prune: %v", err)
		}
		_ = drv.Close()

		b.StartTimer()
	}
}
