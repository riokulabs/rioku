package tracestore

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// benchTrace generates a realistic *riokuv1.RequestTrace for benchmarks.
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

// BenchmarkRingBufferPush measures single-goroutine push throughput.
// Target: >100K ops/sec.
func BenchmarkRingBufferPush(b *testing.B) {
	rb := NewRingBuffer(10_000)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rb.Push(benchTrace(i))
	}
}

// BenchmarkRingBufferPushParallel measures concurrent push throughput.
// Target: >50K ops/sec.
func BenchmarkRingBufferPushParallel(b *testing.B) {
	rb := NewRingBuffer(10_000)
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			rb.Push(benchTrace(i))
			i++
		}
	})
}

// BenchmarkRingBufferSnapshot pre-fills the buffer with 10K items then
// benchmarks Snapshot(100).
func BenchmarkRingBufferSnapshot(b *testing.B) {
	const prefill = 10_000
	rb := NewRingBuffer(prefill)

	b.StopTimer()
	for i := 0; i < prefill; i++ {
		rb.Push(benchTrace(i))
	}
	b.ReportAllocs()
	b.StartTimer()

	for i := 0; i < b.N; i++ {
		_ = rb.Snapshot(100)
	}
}

// BenchmarkRingBufferSubscriberFanout measures per-push overhead with 10
// active subscribers, each with a large enough buffer to avoid drops.
func BenchmarkRingBufferSubscriberFanout(b *testing.B) {
	const numSubs = 10
	rb := NewRingBuffer(10_000)

	unsubs := make([]func(), numSubs)
	for i := 0; i < numSubs; i++ {
		_, unsub := rb.Subscribe(b.N + numSubs)
		unsubs[i] = unsub
	}
	defer func() {
		for _, u := range unsubs {
			u()
		}
	}()

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rb.Push(benchTrace(i))
	}
}
