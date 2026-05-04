package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
)

// recordingHandler counts every slog.Record it receives so tests can
// assert how many records the SamplingHandler kept vs. dropped.
type recordingHandler struct {
	count atomic.Int64
}

func (h *recordingHandler) Enabled(_ context.Context, _ slog.Level) bool { return true }
func (h *recordingHandler) Handle(_ context.Context, _ slog.Record) error {
	h.count.Add(1)
	return nil
}
func (h *recordingHandler) WithAttrs(_ []slog.Attr) slog.Handler { return h }
func (h *recordingHandler) WithGroup(_ string) slog.Handler      { return h }

func TestShouldSample_Boundaries(t *testing.T) {
	if !ShouldSample("any", 1.0) {
		t.Fatal("rate=1.0 must always keep")
	}
	if ShouldSample("any", 0.0) {
		t.Fatal("rate=0.0 must always drop")
	}
	if ShouldSample("any", -0.5) {
		t.Fatal("rate<0 must always drop")
	}
	if !ShouldSample("any", 1.5) {
		t.Fatal("rate>1 must always keep")
	}
}

func TestShouldSample_Deterministic(t *testing.T) {
	const id = "req-deadbeef"
	first := ShouldSample(id, 0.5)
	for i := 0; i < 100; i++ {
		if got := ShouldSample(id, 0.5); got != first {
			t.Fatalf("ShouldSample diverged on iter %d: %v vs %v", i, got, first)
		}
	}
}

func TestShouldSample_DistributionAt50Percent(t *testing.T) {
	const N = 10000
	keep := 0
	for i := 0; i < N; i++ {
		if ShouldSample(fmt.Sprintf("req-%d", i), 0.5) {
			keep++
		}
	}
	// Loose band — hash distribution + N=10k → 4400-5600 is generous.
	if keep < 4400 || keep > 5600 {
		t.Fatalf("kept %d / %d at rate=0.5; expected ~5000 ± 600", keep, N)
	}
}

func TestSamplingHandler_PassesThroughWhenNoRate(t *testing.T) {
	rec := &recordingHandler{}
	h := NewSamplingHandler(rec)
	logger := slog.New(h)

	for i := 0; i < 100; i++ {
		logger.Info("no-rate", "request_id", fmt.Sprintf("req-%d", i))
	}
	if got := rec.count.Load(); got != 100 {
		t.Fatalf("got %d records, want 100 (records without log_sample_rate must pass through)", got)
	}
}

func TestSamplingHandler_RateOneKeepsAll(t *testing.T) {
	rec := &recordingHandler{}
	h := NewSamplingHandler(rec)
	logger := slog.New(h)

	for i := 0; i < 100; i++ {
		logger.Info("rate-one",
			"request_id", fmt.Sprintf("req-%d", i),
			"log_sample_rate", 1.0,
		)
	}
	if got := rec.count.Load(); got != 100 {
		t.Fatalf("got %d records, want 100", got)
	}
}

func TestSamplingHandler_RateZeroDropsAll(t *testing.T) {
	rec := &recordingHandler{}
	h := NewSamplingHandler(rec)
	logger := slog.New(h)

	for i := 0; i < 100; i++ {
		logger.Info("rate-zero",
			"request_id", fmt.Sprintf("req-%d", i),
			"log_sample_rate", 0.0,
		)
	}
	if got := rec.count.Load(); got != 0 {
		t.Fatalf("got %d records, want 0 (rate=0.0 drops everything)", got)
	}
}

func TestSamplingHandler_HalfRateApproximatelyHalf(t *testing.T) {
	rec := &recordingHandler{}
	h := NewSamplingHandler(rec)
	logger := slog.New(h)

	const N = 10000
	for i := 0; i < N; i++ {
		logger.Info("rate-half",
			"request_id", fmt.Sprintf("req-%d", i),
			"log_sample_rate", 0.5,
		)
	}
	got := int(rec.count.Load())
	if got < 4400 || got > 5600 {
		t.Fatalf("kept %d / %d at rate=0.5; expected ~5000 ± 600", got, N)
	}
}

func TestSamplingHandler_MissingRequestIDPassesThrough(t *testing.T) {
	rec := &recordingHandler{}
	h := NewSamplingHandler(rec)
	logger := slog.New(h)

	// Records carrying log_sample_rate but no request_id should pass
	// through. Operators add the rate to a tenant or daemon-wide
	// logger; logs that lack a per-request correlation key should
	// not be silently dropped.
	for i := 0; i < 50; i++ {
		logger.Info("no-id",
			"log_sample_rate", 0.0,
		)
	}
	if got := rec.count.Load(); got != 50 {
		t.Fatalf("got %d, want 50 (no request_id ⇒ no sampling decision)", got)
	}
}

func TestSamplingHandler_StringRateIsAccepted(t *testing.T) {
	rec := &recordingHandler{}
	h := NewSamplingHandler(rec)
	logger := slog.New(h)

	for i := 0; i < 100; i++ {
		logger.Info("string-rate",
			"request_id", fmt.Sprintf("req-%d", i),
			"log_sample_rate", "0.0",
		)
	}
	if got := rec.count.Load(); got != 0 {
		t.Fatalf("got %d, want 0 (string '0.0' must parse and drop)", got)
	}
}

func TestSamplingHandler_RealJSONHandlerEmitsRecords(t *testing.T) {
	// Round-trip test: real JSON handler underneath, confirm the
	// sampler doesn't break message formatting.
	var buf bytes.Buffer
	inner := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	h := NewSamplingHandler(inner)
	logger := slog.New(h)

	logger.Info("hello",
		"request_id", "req-fixed",
		"log_sample_rate", 1.0,
	)
	logger.Info("dropped",
		"request_id", "req-fixed",
		"log_sample_rate", 0.0,
	)

	out := buf.String()
	if !strings.Contains(out, `"msg":"hello"`) {
		t.Fatalf("expected 'hello' message in output, got %q", out)
	}
	if strings.Contains(out, `"msg":"dropped"`) {
		t.Fatalf("dropped message leaked through, got %q", out)
	}

	// Confirm the kept record parses cleanly.
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		var got map[string]any
		if err := json.Unmarshal([]byte(line), &got); err != nil {
			t.Fatalf("json line did not parse: %v\nline: %s", err, line)
		}
	}
}

func TestNewSamplingHandler_NilPanics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on nil inner handler")
		}
	}()
	_ = NewSamplingHandler(nil)
}
