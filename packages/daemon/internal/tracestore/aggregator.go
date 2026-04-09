package tracestore

import (
	"context"
	"fmt"
	"sort"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// Aggregator reads from a RingBuffer on a fixed interval and writes
// pre-aggregated bucket rows to a Driver. It is intended to run as a single
// background goroutine per daemon.
type Aggregator struct {
	buf            *RingBuffer
	store          Driver
	interval       time.Duration
	stop           chan struct{}
	done           chan struct{}
	lastAggregated time.Time
}

// NewAggregator creates an Aggregator that drains buf and writes to store on
// every interval. Call Start to begin background aggregation.
func NewAggregator(buf *RingBuffer, store Driver, interval time.Duration) *Aggregator {
	return &Aggregator{
		buf:      buf,
		store:    store,
		interval: interval,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}

// Start launches the background aggregation goroutine. It returns immediately;
// the goroutine runs until Stop is called or ctx is cancelled.
func (a *Aggregator) Start(ctx context.Context) {
	go func() {
		defer close(a.done)
		ticker := time.NewTicker(a.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := a.RunCycle(ctx); err != nil {
					// Log errors to stderr but continue — the aggregator must
					// not crash the daemon on transient store failures.
					fmt.Printf("tracestore: aggregator cycle error: %v\n", err)
				}
			case <-a.stop:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
}

// Stop signals the background goroutine to exit and waits for it to finish.
// It is safe to call Stop more than once.
func (a *Aggregator) Stop() {
	select {
	case <-a.stop:
		// Already closed.
	default:
		close(a.stop)
	}
	<-a.done
}

// RunCycle snapshots traces from the ring buffer since lastAggregated,
// computes all bucket types, writes them to the store, and advances
// lastAggregated. It is exported so tests can invoke a single cycle directly.
func (a *Aggregator) RunCycle(ctx context.Context) error {
	since := a.lastAggregated
	cycleStart := time.Now()

	traces := a.buf.DrainSince(since)
	if len(traces) == 0 {
		a.lastAggregated = cycleStart
		return nil
	}

	// Persist raw traces to the store for historical queries.
	if err := a.store.WriteBatch(ctx, traces); err != nil {
		return fmt.Errorf("write trace batch: %w", err)
	}

	bucketStart := cycleStart.Truncate(a.interval)

	// Global stats bucket.
	stats := ComputeStatsBucket(traces, bucketStart)
	if err := a.store.WriteStatsBucket(ctx, stats); err != nil {
		return fmt.Errorf("write stats bucket: %w", err)
	}

	// Per-route buckets.
	for _, rb := range ComputeRouteBuckets(traces, bucketStart) {
		if err := a.store.WriteRouteBucket(ctx, rb); err != nil {
			return fmt.Errorf("write route bucket: %w", err)
		}
	}

	// Per-status-class buckets.
	for _, sb := range ComputeStatusBuckets(traces, bucketStart) {
		if err := a.store.WriteStatusBucket(ctx, sb); err != nil {
			return fmt.Errorf("write status bucket: %w", err)
		}
	}

	// Per-model AI buckets.
	for _, mb := range ComputeModelBuckets(traces, bucketStart) {
		if err := a.store.WriteModelBucket(ctx, mb); err != nil {
			return fmt.Errorf("write model bucket: %w", err)
		}
	}

	a.lastAggregated = cycleStart
	return nil
}

// ---------------------------------------------------------------------------
// Pure computation functions — no I/O, easy to test.
// ---------------------------------------------------------------------------

// ComputeStatsBucket computes global request statistics for a set of traces.
func ComputeStatsBucket(traces []*riokuv1.RequestTrace, bucketStart time.Time) StatsBucket {
	if len(traces) == 0 {
		return StatsBucket{BucketStart: bucketStart}
	}

	var (
		errorCount int64
		bytesSent  int64
		bytesRecv  int64
		latencies  = make([]int64, 0, len(traces))
	)

	for _, tr := range traces {
		latencies = append(latencies, tr.GetDurationMs())
		if tr.GetStatusCode() >= 500 {
			errorCount++
		}
		bytesSent += tr.GetBytesSent()
		bytesRecv += tr.GetBytesRecv()
	}

	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })

	return StatsBucket{
		BucketStart:  bucketStart,
		RequestCount: int64(len(traces)),
		ErrorCount:   errorCount,
		P50LatencyMS: Percentile(latencies, 0.50),
		P95LatencyMS: Percentile(latencies, 0.95),
		P99LatencyMS: Percentile(latencies, 0.99),
		BytesSent:    bytesSent,
		BytesRecv:    bytesRecv,
	}
}

// ComputeRouteBuckets groups traces by route and computes per-route statistics.
func ComputeRouteBuckets(traces []*riokuv1.RequestTrace, bucketStart time.Time) []RouteBucket {
	type routeAccum struct {
		count      int64
		errorCount int64
		totalMS    int64
	}

	accum := make(map[string]*routeAccum)
	for _, tr := range traces {
		rid := tr.GetRouteId()
		a := accum[rid]
		if a == nil {
			a = &routeAccum{}
			accum[rid] = a
		}
		a.count++
		a.totalMS += tr.GetDurationMs()
		if tr.GetStatusCode() >= 500 {
			a.errorCount++
		}
	}

	buckets := make([]RouteBucket, 0, len(accum))
	for rid, a := range accum {
		avg := int64(0)
		if a.count > 0 {
			avg = a.totalMS / a.count
		}
		buckets = append(buckets, RouteBucket{
			BucketStart:  bucketStart,
			RouteID:      rid,
			RequestCount: a.count,
			ErrorCount:   a.errorCount,
			AvgLatencyMS: avg,
		})
	}

	return buckets
}

// ComputeStatusBuckets groups traces by HTTP status class (2xx, 4xx, 5xx, etc.)
// and returns one bucket per observed class.
func ComputeStatusBuckets(traces []*riokuv1.RequestTrace, bucketStart time.Time) []StatusBucket {
	counts := make(map[string]int64)
	for _, tr := range traces {
		class := statusClass(tr.GetStatusCode())
		counts[class]++
	}

	buckets := make([]StatusBucket, 0, len(counts))
	for class, count := range counts {
		buckets = append(buckets, StatusBucket{
			BucketStart:  bucketStart,
			StatusClass:  class,
			RequestCount: count,
		})
	}

	return buckets
}

// ComputeModelBuckets groups AI traces by provider+model and aggregates token
// and cost totals.
func ComputeModelBuckets(traces []*riokuv1.RequestTrace, bucketStart time.Time) []ModelBucket {
	type key struct{ provider, model string }
	type accum struct {
		count  int64
		tokens int64
		cost   float64
	}

	m := make(map[key]*accum)
	for _, tr := range traces {
		ai := tr.GetAi()
		if ai == nil {
			continue
		}
		k := key{ai.GetProvider(), ai.GetModel()}
		a := m[k]
		if a == nil {
			a = &accum{}
			m[k] = a
		}
		a.count++
		a.tokens += ai.GetTotalTokens()
		a.cost += ai.GetEstimatedCostUsd()
	}

	buckets := make([]ModelBucket, 0, len(m))
	for k, a := range m {
		buckets = append(buckets, ModelBucket{
			BucketStart:      bucketStart,
			Provider:         k.provider,
			Model:            k.model,
			RequestCount:     a.count,
			TotalTokens:      a.tokens,
			EstimatedCostUSD: a.cost,
		})
	}

	return buckets
}

// Percentile returns the value at percentile p (0.0–1.0) of a pre-sorted
// slice. Uses the ceiling formula: index = ceil(p * n) - 1.
//
// Returns 0 for an empty slice.
func Percentile(sorted []int64, p float64) int64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	// ceil(p * n) - 1, clamped to [0, n-1].
	idx := int(p*float64(n)+0.9999999) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= n {
		idx = n - 1
	}
	return sorted[idx]
}

// statusClass converts an HTTP status code into a string class like "2xx".
func statusClass(code int32) string {
	switch code / 100 {
	case 1:
		return "1xx"
	case 2:
		return "2xx"
	case 3:
		return "3xx"
	case 4:
		return "4xx"
	case 5:
		return "5xx"
	default:
		return "other"
	}
}
