package tracestore

import (
	"sync"
	"testing"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// makeTrace creates a minimal RequestTrace with a given trace ID and started-at time.
func makeTrace(id string, t time.Time) *riokuv1.RequestTrace {
	return &riokuv1.RequestTrace{
		TraceId:   id,
		StartedAt: timestamppb.New(t),
	}
}

// traceIDs extracts TraceId from a slice — handy for assertions.
func traceIDs(traces []*riokuv1.RequestTrace) []string {
	ids := make([]string, len(traces))
	for i, tr := range traces {
		ids[i] = tr.TraceId
	}
	return ids
}

// TestRingBuffer_PushAndSnapshot pushes N items and verifies Snapshot returns
// them in insertion order (oldest first).
func TestRingBuffer_PushAndSnapshot(t *testing.T) {
	rb := NewRingBuffer(8)

	now := time.Now()
	want := []string{"a", "b", "c", "d"}
	for i, id := range want {
		rb.Push(makeTrace(id, now.Add(time.Duration(i)*time.Second)))
	}

	got := traceIDs(rb.Snapshot(10))
	if len(got) != len(want) {
		t.Fatalf("Snapshot len = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Snapshot[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestRingBuffer_Overflow pushes more than capacity, verifies oldest entries
// are dropped and the Dropped counter is incremented accordingly.
func TestRingBuffer_Overflow(t *testing.T) {
	capacity := 4
	rb := NewRingBuffer(capacity)

	now := time.Now()
	// Push capacity+2 items: "a","b","c","d","e","f"
	ids := []string{"a", "b", "c", "d", "e", "f"}
	for i, id := range ids {
		rb.Push(makeTrace(id, now.Add(time.Duration(i)*time.Second)))
	}

	// Buffer should contain the last 4: "c","d","e","f"
	snap := rb.Snapshot(10)
	got := traceIDs(snap)
	want := []string{"c", "d", "e", "f"}
	if len(got) != len(want) {
		t.Fatalf("Snapshot len = %d, want %d; got %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Snapshot[%d] = %q, want %q", i, got[i], want[i])
		}
	}

	// 2 items were dropped ("a" and "b")
	dropped := rb.Dropped()
	if dropped != 2 {
		t.Errorf("Dropped() = %d, want 2", dropped)
	}

	// Len should equal capacity
	if n := rb.Len(); n != capacity {
		t.Errorf("Len() = %d, want %d", n, capacity)
	}
}

// TestRingBuffer_Subscribe verifies that a subscriber channel receives pushed
// items.
func TestRingBuffer_Subscribe(t *testing.T) {
	rb := NewRingBuffer(16)

	ch, unsub := rb.Subscribe(16)
	defer unsub()

	now := time.Now()
	ids := []string{"x", "y", "z"}
	for i, id := range ids {
		rb.Push(makeTrace(id, now.Add(time.Duration(i)*time.Second)))
	}

	for _, wantID := range ids {
		select {
		case tr := <-ch:
			if tr.TraceId != wantID {
				t.Errorf("subscriber got %q, want %q", tr.TraceId, wantID)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for trace %q", wantID)
		}
	}
}

// TestRingBuffer_SlowSubscriber verifies that a slow subscriber (full channel)
// does not block Push() or other subscribers.
func TestRingBuffer_SlowSubscriber(t *testing.T) {
	rb := NewRingBuffer(64)

	// Slow subscriber: buffer size 1 so it fills up quickly.
	slowCh, slowUnsub := rb.Subscribe(1)
	defer slowUnsub()

	// Fast subscriber: large buffer.
	fastCh, fastUnsub := rb.Subscribe(128)
	defer fastUnsub()

	now := time.Now()
	const n = 50
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < n; i++ {
			rb.Push(makeTrace("t", now.Add(time.Duration(i)*time.Millisecond)))
		}
	}()

	// Push goroutine must complete promptly — 2 s is very generous.
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Push blocked waiting on slow subscriber")
	}

	// Fast subscriber should have received all (or most) events. The important
	// guarantee is that Push did NOT block. The fast channel has capacity 128
	// and we pushed 50, so it should have all of them.
	received := 0
	timeout := time.After(500 * time.Millisecond)
drain:
	for {
		select {
		case <-fastCh:
			received++
			if received == n {
				break drain
			}
		case <-timeout:
			break drain
		}
	}
	if received != n {
		t.Errorf("fast subscriber received %d/%d events", received, n)
	}

	// The slow channel should have at least 1 item (its first slot got filled)
	// and should not have caused a deadlock.
	select {
	case <-slowCh:
		// fine — at least one item made it through
	default:
		// also fine — the slow subscriber may have missed everything
	}
}

// TestRingBuffer_Unsubscribe verifies that the channel is closed after the
// unsubscribe function is called.
func TestRingBuffer_Unsubscribe(t *testing.T) {
	rb := NewRingBuffer(8)

	ch, unsub := rb.Subscribe(8)
	unsub()

	// Channel must be closed (a receive on a closed nil-buffered channel
	// returns immediately with the zero value).
	select {
	case _, ok := <-ch:
		if ok {
			t.Error("channel was not closed after Unsubscribe")
		}
	case <-time.After(time.Second):
		t.Error("channel was not closed within 1s after Unsubscribe")
	}
}

// TestRingBuffer_DrainSince verifies that DrainSince returns only traces with
// StartedAt >= the given time and does NOT remove them from the ring buffer.
func TestRingBuffer_DrainSince(t *testing.T) {
	rb := NewRingBuffer(16)

	base := time.Now().Truncate(time.Millisecond)
	// Push 5 traces separated by 1 second each.
	for i := 0; i < 5; i++ {
		rb.Push(makeTrace(string(rune('0'+i)), base.Add(time.Duration(i)*time.Second)))
	}

	// DrainSince the 3rd trace (index 2, time base+2s). Should return traces 2,3,4.
	cutoff := base.Add(2 * time.Second)
	result := rb.DrainSince(cutoff)
	got := traceIDs(result)
	want := []string{"2", "3", "4"}
	if len(got) != len(want) {
		t.Fatalf("DrainSince len = %d, want %d; got %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("DrainSince[%d] = %q, want %q", i, got[i], want[i])
		}
	}

	// Items must still be in the ring buffer.
	if n := rb.Len(); n != 5 {
		t.Errorf("Len() after DrainSince = %d, want 5 (items should not be removed)", n)
	}

	// Calling DrainSince again with the same cutoff should return the same set.
	result2 := rb.DrainSince(cutoff)
	if len(result2) != len(want) {
		t.Errorf("second DrainSince len = %d, want %d", len(result2), len(want))
	}
}

// TestRingBuffer_ConcurrentPush verifies there are no races when multiple
// goroutines push concurrently.
func TestRingBuffer_ConcurrentPush(t *testing.T) {
	rb := NewRingBuffer(32)

	ch, unsub := rb.Subscribe(128)
	defer unsub()

	var wg sync.WaitGroup
	now := time.Now()
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 20; i++ {
				rb.Push(makeTrace("t", now.Add(time.Duration(g*20+i)*time.Millisecond)))
			}
		}(g)
	}
	wg.Wait()

	// Drain subscriber channel without blocking.
	timeout := time.After(500 * time.Millisecond)
	for {
		select {
		case <-ch:
		case <-timeout:
			goto done
		}
	}
done:
	// Just checking no race or deadlock — no specific count assertion needed.
	if rb.Len() == 0 {
		t.Error("expected at least some traces in ring buffer after concurrent pushes")
	}
}
