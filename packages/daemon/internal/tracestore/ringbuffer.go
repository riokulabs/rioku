package tracestore

import (
	"sync"
	"sync/atomic"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// RingBuffer is a bounded, thread-safe circular buffer of *riokuv1.RequestTrace
// with drop-oldest semantics and subscriber fan-out.
//
// Push is the hot path; a sync.Mutex is used throughout (rather than RWMutex)
// because Push writes on every call and contention on Snapshot/DrainSince is
// expected to be infrequent.
type RingBuffer struct {
	mu          sync.Mutex
	buf         []*riokuv1.RequestTrace
	head        int   // index of the oldest element
	count       int   // number of valid elements currently stored
	capacity    int   // fixed capacity of buf
	dropped     int64 // atomic — incremented when an element is overwritten
	nextSubID   uint64
	subscribers map[uint64]chan *riokuv1.RequestTrace
}

// NewRingBuffer allocates a RingBuffer with the given capacity.
// Panics if capacity <= 0.
func NewRingBuffer(capacity int) *RingBuffer {
	if capacity <= 0 {
		panic("tracestore: RingBuffer capacity must be > 0")
	}
	return &RingBuffer{
		buf:         make([]*riokuv1.RequestTrace, capacity),
		capacity:    capacity,
		subscribers: make(map[uint64]chan *riokuv1.RequestTrace),
	}
}

// Push appends trace to the ring buffer.
//
//   - If the buffer is full the oldest element is silently dropped and the
//     dropped counter is incremented atomically.
//   - Each registered subscriber receives a non-blocking send; if a
//     subscriber's channel is full the trace is dropped for that subscriber
//     only — Push never blocks.
func (rb *RingBuffer) Push(trace *riokuv1.RequestTrace) {
	rb.mu.Lock()

	tail := (rb.head + rb.count) % rb.capacity
	if rb.count == rb.capacity {
		// Overwrite oldest: advance head and record the drop.
		rb.buf[tail] = trace
		rb.head = (rb.head + 1) % rb.capacity
		// Unlock before the atomic increment so we don't hold the lock
		// longer than necessary. The dropped counter is updated outside
		// the critical section.
		subs := rb.copySubscribers()
		rb.mu.Unlock()
		atomic.AddInt64(&rb.dropped, 1)
		rb.fanOut(subs, trace)
		return
	}

	rb.buf[tail] = trace
	rb.count++
	subs := rb.copySubscribers()
	rb.mu.Unlock()

	rb.fanOut(subs, trace)
}

// copySubscribers returns a shallow copy of the subscriber map while the mutex
// is held. Callers must hold rb.mu when calling this.
func (rb *RingBuffer) copySubscribers() []chan *riokuv1.RequestTrace {
	if len(rb.subscribers) == 0 {
		return nil
	}
	out := make([]chan *riokuv1.RequestTrace, 0, len(rb.subscribers))
	for _, ch := range rb.subscribers {
		out = append(out, ch)
	}
	return out
}

// fanOut sends trace to each subscriber channel without blocking.
func (rb *RingBuffer) fanOut(subs []chan *riokuv1.RequestTrace, trace *riokuv1.RequestTrace) {
	for _, ch := range subs {
		select {
		case ch <- trace:
		default:
			// Subscriber channel full — drop silently.
		}
	}
}

// Snapshot returns a copy of up to limit traces in insertion order (oldest
// first). Pass a limit larger than Len() (or math.MaxInt) to get all items.
func (rb *RingBuffer) Snapshot(limit int) []*riokuv1.RequestTrace {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	n := rb.count
	if limit < n {
		n = limit
	}
	if n == 0 {
		return nil
	}

	out := make([]*riokuv1.RequestTrace, n)
	// Start at head (oldest) and walk forward.
	start := rb.head
	if limit < rb.count {
		// Caller wants only the most recent `limit` entries; skip the oldest.
		skip := rb.count - limit
		start = (rb.head + skip) % rb.capacity
	}
	for i := 0; i < n; i++ {
		out[i] = rb.buf[(start+i)%rb.capacity]
	}
	return out
}

// Subscribe returns a read-only channel that receives traces as they are
// pushed, and an unsubscribe function.
//
// bufSize controls the depth of the subscriber's channel. A larger value
// reduces the chance of drops for slow consumers. When the channel is full
// incoming traces are dropped silently (Push never blocks).
//
// Calling the returned unsubscribe function removes the subscriber and closes
// the channel. It is safe to call unsubscribe more than once.
func (rb *RingBuffer) Subscribe(bufSize int) (<-chan *riokuv1.RequestTrace, func()) {
	if bufSize <= 0 {
		bufSize = 64
	}
	ch := make(chan *riokuv1.RequestTrace, bufSize)

	rb.mu.Lock()
	id := rb.nextSubID
	rb.nextSubID++
	rb.subscribers[id] = ch
	rb.mu.Unlock()

	var once sync.Once
	unsub := func() {
		once.Do(func() {
			rb.mu.Lock()
			delete(rb.subscribers, id)
			rb.mu.Unlock()
			close(ch)
		})
	}
	return ch, unsub
}

// DrainSince returns all traces whose StartedAt is >= since. The traces remain
// in the ring buffer; this method is a read-only view intended for the
// aggregator to collect recent traces for bucket computation.
func (rb *RingBuffer) DrainSince(since time.Time) []*riokuv1.RequestTrace {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	var out []*riokuv1.RequestTrace
	for i := 0; i < rb.count; i++ {
		tr := rb.buf[(rb.head+i)%rb.capacity]
		if tr == nil {
			continue
		}
		if !tr.GetStartedAt().AsTime().Before(since) {
			out = append(out, tr)
		}
	}
	return out
}

// Dropped returns the total number of traces that were overwritten due to the
// buffer being full. The value is updated atomically and can be read without
// holding the mutex.
func (rb *RingBuffer) Dropped() int64 {
	return atomic.LoadInt64(&rb.dropped)
}

// Len returns the number of traces currently stored in the buffer.
func (rb *RingBuffer) Len() int {
	rb.mu.Lock()
	n := rb.count
	rb.mu.Unlock()
	return n
}
