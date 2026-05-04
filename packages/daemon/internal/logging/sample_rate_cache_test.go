package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"testing"
)

func TestSampleRateCache_GetMissReturnsFalse(t *testing.T) {
	c := NewSampleRateCache()
	if _, ok := c.Get("r-unknown"); ok {
		t.Error("Get on empty cache returned ok=true")
	}
}

func TestSampleRateCache_ReplaceAtomic(t *testing.T) {
	c := NewSampleRateCache()
	c.Replace(map[string]float64{"r1": 0.1, "r2": 1.0})

	r, ok := c.Get("r1")
	if !ok || r != 0.1 {
		t.Errorf("r1: got (%v, %v), want (0.1, true)", r, ok)
	}
	r, ok = c.Get("r2")
	if !ok || r != 1.0 {
		t.Errorf("r2: got (%v, %v), want (1.0, true)", r, ok)
	}

	// Replace with a smaller set — entries from the previous map go away.
	c.Replace(map[string]float64{"r3": 0.5})
	if _, ok := c.Get("r1"); ok {
		t.Error("r1 still present after Replace dropped it")
	}
	if r, ok := c.Get("r3"); !ok || r != 0.5 {
		t.Errorf("r3: got (%v, %v)", r, ok)
	}
}

func TestSampleRateCache_NilSafe(t *testing.T) {
	var c *SampleRateCache
	if _, ok := c.Get("r1"); ok {
		t.Error("nil cache returned ok=true")
	}
	if c.Len() != 0 {
		t.Errorf("nil cache Len = %d", c.Len())
	}
}

func TestSampleRateCache_ConcurrentReadWrite(t *testing.T) {
	c := NewSampleRateCache()
	c.Replace(map[string]float64{"r1": 1.0})

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _ = c.Get("r1")
		}()
		go func() {
			defer wg.Done()
			c.Replace(map[string]float64{"r1": 0.5, "r2": 0.25})
		}()
	}
	wg.Wait()

	if c.Len() != 2 {
		t.Errorf("Len = %d, want 2", c.Len())
	}
}

func TestContextHandler_PopulatesLogSampleRateFromCtx(t *testing.T) {
	var buf bytes.Buffer
	inner := slog.NewJSONHandler(&buf, nil)
	ctxH := NewContextHandler(inner)
	logger := slog.New(ctxH)

	ctx := WithRequestID(context.Background(), "req_abc")
	ctx = WithLogSampleRate(ctx, 0.5)
	ctx = WithRouteID(ctx, "route_xyz")
	logger.InfoContext(ctx, "test")

	var rec map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &rec); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if rec["log_sample_rate"] != 0.5 {
		t.Errorf("log_sample_rate = %v, want 0.5", rec["log_sample_rate"])
	}
	if rec["route_id"] != "route_xyz" {
		t.Errorf("route_id = %v, want route_xyz", rec["route_id"])
	}
	if rec["request_id"] != "req_abc" {
		t.Errorf("request_id = %v", rec["request_id"])
	}
}

func TestContextHandler_NoLogSampleRateWhenAbsent(t *testing.T) {
	var buf bytes.Buffer
	inner := slog.NewJSONHandler(&buf, nil)
	ctxH := NewContextHandler(inner)
	logger := slog.New(ctxH)

	logger.InfoContext(context.Background(), "test")

	if strings.Contains(buf.String(), "log_sample_rate") {
		t.Errorf("log_sample_rate present without ctx setter: %s", buf.String())
	}
}
