package strategies

import (
	"errors"
	"testing"
)

func TestRegistry_Builds3DefaultStrategies(t *testing.T) {
	r := NewRegistry()
	for _, name := range []string{"simple_shuffle", "fallback", "latency"} {
		s, err := r.Build(name, nil)
		if err != nil {
			t.Fatalf("Build(%s): %v", name, err)
		}
		if s.Name() != name {
			t.Errorf("Name() = %q, want %q", s.Name(), name)
		}
	}
}

func TestRegistry_UnknownStrategy(t *testing.T) {
	r := NewRegistry()
	if _, err := r.Build("ml-bandit", nil); err == nil {
		t.Error("Build(ml-bandit) should error")
	}
}

func TestSimpleShuffle_PreservesAll(t *testing.T) {
	s := NewSimpleShuffle()
	in := []Upstream{
		{ID: "a", Weight: 1},
		{ID: "b", Weight: 5},
		{ID: "c", Weight: 1},
	}
	picked := s.Pick(in)
	if len(picked) != len(in) {
		t.Fatalf("len(picked) = %d, want %d", len(picked), len(in))
	}
	seen := map[string]bool{}
	for _, u := range picked {
		seen[u.ID] = true
	}
	for _, u := range in {
		if !seen[u.ID] {
			t.Errorf("missing %q from shuffled list", u.ID)
		}
	}
}

func TestSimpleShuffle_WeightBias(t *testing.T) {
	s := NewSimpleShuffle()
	heavy := "h"
	light := "l"
	in := []Upstream{
		{ID: light, Weight: 1},
		{ID: heavy, Weight: 100},
	}
	heavyFirst := 0
	const trials = 1000
	for i := 0; i < trials; i++ {
		picked := s.Pick(in)
		if picked[0].ID == heavy {
			heavyFirst++
		}
	}
	// Heavy weight 100 vs light weight 1 — the biased shuffle
	// should put heavy first far more than half the time. We do
	// not pin to exact percentages because this is a randomized
	// algorithm; we only assert the bias direction is right.
	if heavyFirst < trials*7/10 {
		t.Errorf("heavy upstream picked first %d/%d times — expected >= 70%% bias", heavyFirst, trials)
	}
}

func TestFallback_OrdersByPriority(t *testing.T) {
	s := NewFallback(nil)
	in := []Upstream{
		{ID: "c", Priority: 30},
		{ID: "a", Priority: 10},
		{ID: "b", Priority: 20},
	}
	got := s.Pick(in)
	want := []string{"a", "b", "c"}
	for i, u := range got {
		if u.ID != want[i] {
			t.Errorf("position %d: got %q, want %q", i, u.ID, want[i])
		}
	}
}

func TestFallback_TriggerDefaults(t *testing.T) {
	cases := []struct {
		o    Outcome
		want bool
	}{
		{Outcome{Status: 200}, false},
		{Outcome{Status: 408}, true},
		{Outcome{Status: 429}, true},
		{Outcome{Status: 500}, true},
		{Outcome{Status: 503}, true},
		{Outcome{Status: 0, Err: errors.New("conn refused")}, true},
		{Outcome{Status: 401}, false}, // not in default list
		{Outcome{Status: 404}, false},
	}
	for _, c := range cases {
		if got := ShouldFallback(c.o, FallbackTriggers); got != c.want {
			t.Errorf("ShouldFallback(%+v) = %v, want %v", c.o, got, c.want)
		}
	}
}

func TestFallback_CustomTriggers(t *testing.T) {
	// JSON decode produces []any, float64.
	cfg := map[string]any{
		"triggers": []any{float64(401), float64(503)},
	}
	s := NewFallback(cfg).(*fallback)
	if !ShouldFallback(Outcome{Status: 401}, s.Triggers()) {
		t.Error("custom 401 should trigger")
	}
	if ShouldFallback(Outcome{Status: 500}, s.Triggers()) {
		t.Error("500 should not trigger when custom triggers replaced defaults")
	}
}

func TestLatency_PicksLowest(t *testing.T) {
	s := NewLatency(nil).(*latency)
	in := []Upstream{
		{ID: "slow"},
		{ID: "fast"},
		{ID: "mid"},
	}
	// Seed EWMA via observations.
	s.Observe(Outcome{UpstreamID: "slow", LatencyMS: 800, Status: 200})
	s.Observe(Outcome{UpstreamID: "mid", LatencyMS: 250, Status: 200})
	s.Observe(Outcome{UpstreamID: "fast", LatencyMS: 50, Status: 200})

	got := s.Pick(in)
	if got[0].ID != "fast" {
		t.Errorf("first = %q, want fast", got[0].ID)
	}
	if got[2].ID != "slow" {
		t.Errorf("last = %q, want slow", got[2].ID)
	}
}

func TestLatency_UnobservedSortsLast(t *testing.T) {
	s := NewLatency(nil)
	in := []Upstream{
		{ID: "fresh"},
		{ID: "warmed"},
	}
	s.Observe(Outcome{UpstreamID: "warmed", LatencyMS: 200, Status: 200})

	got := s.Pick(in)
	if got[0].ID != "warmed" {
		t.Errorf("first = %q, want warmed (only one with data)", got[0].ID)
	}
	if got[1].ID != "fresh" {
		t.Errorf("last = %q, want fresh (no signal)", got[1].ID)
	}
}

func TestLatency_TransportErrorPenalizes(t *testing.T) {
	s := NewLatency(nil).(*latency)
	s.Observe(Outcome{UpstreamID: "broken", Status: 0, Err: errors.New("timeout")})
	snap := s.Snapshot()
	if snap["broken"] < 1000 {
		t.Errorf("broken EWMA = %f, want >= 1000 (transport error penalty)", snap["broken"])
	}
}

func TestLatency_EWMASmoothing(t *testing.T) {
	s := NewLatency(map[string]any{"decay": 0.5}).(*latency)
	s.Observe(Outcome{UpstreamID: "u", LatencyMS: 100, Status: 200})
	// Second sample at 200ms with decay 0.5 → 0.5*100 + 0.5*200 = 150.
	s.Observe(Outcome{UpstreamID: "u", LatencyMS: 200, Status: 200})
	snap := s.Snapshot()
	if got := snap["u"]; got < 149 || got > 151 {
		t.Errorf("EWMA = %f, want ≈ 150 with decay 0.5", got)
	}
}

func TestEmptyInputReturnsNil(t *testing.T) {
	for _, s := range []Strategy{
		NewSimpleShuffle(),
		NewFallback(nil),
		NewLatency(nil),
	} {
		if got := s.Pick(nil); got != nil {
			t.Errorf("%s: Pick(nil) = %v, want nil", s.Name(), got)
		}
	}
}
