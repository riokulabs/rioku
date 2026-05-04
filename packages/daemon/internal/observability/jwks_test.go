package observability

import (
	"sync"
	"testing"
	"time"
)

func fixedClock(at time.Time) func() time.Time {
	return func() time.Time { return at }
}

func TestJWKSRegistry_RegisterIdempotent(t *testing.T) {
	r := NewJWKSRegistry()
	r.SetClock(fixedClock(time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)))

	r.Register("https://idp/.well-known/jwks.json")
	r.Register("https://idp/.well-known/jwks.json")

	snap := r.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("len = %d, want 1", len(snap))
	}
	if snap[0].Status != JWKSStatusRegistered {
		t.Errorf("status = %q, want %q", snap[0].Status, JWKSStatusRegistered)
	}
}

func TestJWKSRegistry_RecordSuccess(t *testing.T) {
	r := NewJWKSRegistry()
	t0 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	r.SetClock(fixedClock(t0))

	r.Register("u")
	r.Record(JWKSEvent{URL: "u", Status: JWKSStatusOK, At: t0.Add(time.Minute)})

	e := r.Snapshot()[0]
	if e.Status != JWKSStatusOK {
		t.Errorf("status = %q", e.Status)
	}
	if e.LastSuccessAt == nil {
		t.Fatal("LastSuccessAt nil")
	}
	if !e.LastSuccessAt.Equal(t0.Add(time.Minute)) {
		t.Errorf("LastSuccessAt = %v", e.LastSuccessAt)
	}
	if e.RefreshCount != 1 {
		t.Errorf("RefreshCount = %d", e.RefreshCount)
	}
}

func TestJWKSRegistry_RecordErrorIncrementsConsecutive(t *testing.T) {
	r := NewJWKSRegistry()
	t0 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	r.Register("u")

	r.Record(JWKSEvent{URL: "u", Status: JWKSStatusError, Error: "boom", At: t0})
	r.Record(JWKSEvent{URL: "u", Status: JWKSStatusError, Error: "still", At: t0.Add(time.Minute)})
	r.Record(JWKSEvent{URL: "u", Status: JWKSStatusError, Error: "yep", At: t0.Add(2 * time.Minute)})

	e := r.Snapshot()[0]
	if e.ConsecutiveFail != 3 {
		t.Errorf("ConsecutiveFail = %d, want 3", e.ConsecutiveFail)
	}
	if e.FailureCount != 3 {
		t.Errorf("FailureCount = %d, want 3", e.FailureCount)
	}
	if e.LastError != "yep" {
		t.Errorf("LastError = %q", e.LastError)
	}
}

func TestJWKSRegistry_SuccessResetsConsecutiveFail(t *testing.T) {
	r := NewJWKSRegistry()
	t0 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)

	r.Register("u")
	r.Record(JWKSEvent{URL: "u", Status: JWKSStatusError, Error: "x", At: t0})
	r.Record(JWKSEvent{URL: "u", Status: JWKSStatusError, Error: "y", At: t0.Add(time.Minute)})
	r.Record(JWKSEvent{URL: "u", Status: JWKSStatusOK, At: t0.Add(2 * time.Minute)})

	e := r.Snapshot()[0]
	if e.ConsecutiveFail != 0 {
		t.Errorf("ConsecutiveFail = %d, want 0 after success", e.ConsecutiveFail)
	}
	if e.LastError != "" {
		t.Errorf("LastError should clear on success, got %q", e.LastError)
	}
}

func TestJWKSRegistry_AutoRegisterOnRecord(t *testing.T) {
	r := NewJWKSRegistry()
	t0 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	r.SetClock(fixedClock(t0))

	// Skip Register; the plugin reports on a URL we haven't seen.
	r.Record(JWKSEvent{URL: "u", Status: JWKSStatusOK, At: t0})

	snap := r.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("len = %d, want 1", len(snap))
	}
	if snap[0].URL != "u" {
		t.Errorf("URL = %q", snap[0].URL)
	}
}

func TestJWKSRegistry_ConcurrentSafe(t *testing.T) {
	r := NewJWKSRegistry()
	r.Register("u")

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			if n%2 == 0 {
				r.Record(JWKSEvent{URL: "u", Status: JWKSStatusOK, At: time.Now()})
			} else {
				r.Record(JWKSEvent{URL: "u", Status: JWKSStatusError, Error: "e", At: time.Now()})
			}
			_ = r.Snapshot()
		}(i)
	}
	wg.Wait()

	e := r.Snapshot()[0]
	if e.RefreshCount != 100 {
		t.Errorf("RefreshCount = %d, want 100", e.RefreshCount)
	}
}
