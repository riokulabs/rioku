package logging_test

import (
	"context"
	"log/slog"
	"testing"
	"time"

	otellog "go.opentelemetry.io/otel/log"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/logging"
)

// ─── NewOTLPHandler disabled path ───────────────────────────────────────────

func TestNewOTLPHandler_DisabledReturnsError(t *testing.T) {
	cfg := config.LogOTLPConfig{Enabled: false}
	_, _, err := logging.NewOTLPHandler(context.Background(), cfg, slog.LevelInfo, nil)
	if err == nil {
		t.Fatal("expected error when OTLP is disabled")
	}
}

func TestNewOTLPHandler_MissingEndpointReturnsError(t *testing.T) {
	cfg := config.LogOTLPConfig{Enabled: true, Endpoint: ""}
	_, _, err := logging.NewOTLPHandler(context.Background(), cfg, slog.LevelInfo, nil)
	if err == nil {
		t.Fatal("expected error when endpoint is empty")
	}
}

// ─── slogLevelToOtel ────────────────────────────────────────────────────────

func TestSlogLevelToOtel(t *testing.T) {
	cases := []struct {
		level slog.Level
		want  otellog.Severity
	}{
		{slog.LevelDebug, otellog.SeverityDebug},
		{slog.LevelInfo, otellog.SeverityInfo},
		{slog.LevelWarn, otellog.SeverityWarn},
		{slog.LevelError, otellog.SeverityError},
		// boundary: one step below Info is still Debug
		{slog.LevelInfo - 1, otellog.SeverityDebug},
		// boundary: one step below Warn is still Info
		{slog.LevelWarn - 1, otellog.SeverityInfo},
		// boundary: one step below Error is still Warn
		{slog.LevelError - 1, otellog.SeverityWarn},
	}
	for _, tc := range cases {
		got := logging.SlogLevelToOtelExported(tc.level)
		if got != tc.want {
			t.Errorf("SlogLevelToOtel(%v) = %v, want %v", tc.level, got, tc.want)
		}
	}
}

// ─── slogAttrToOtel ─────────────────────────────────────────────────────────

func TestSlogAttrToOtel(t *testing.T) {
	now := time.Now()
	dur := 5 * time.Second

	cases := []struct {
		attr     slog.Attr
		wantKey  string
		wantKind otellog.Kind
	}{
		{slog.String("s", "hello"), "s", otellog.KindString},
		{slog.Int64("i", 42), "i", otellog.KindInt64},
		{slog.Float64("f", 3.14), "f", otellog.KindFloat64},
		{slog.Bool("b", true), "b", otellog.KindBool},
		{slog.Duration("d", dur), "d", otellog.KindString},
		{slog.Time("t", now), "t", otellog.KindString},
	}
	for _, tc := range cases {
		kv := logging.SlogAttrToOtelExported(tc.attr)
		if kv.Key != tc.wantKey {
			t.Errorf("key = %q, want %q", kv.Key, tc.wantKey)
		}
		if kv.Value.Kind() != tc.wantKind {
			t.Errorf("attr %q: kind = %v, want %v", tc.attr.Key, kv.Value.Kind(), tc.wantKind)
		}
	}
}

// ─── MultiHandler ───────────────────────────────────────────────────────────

func TestMultiHandler_ForwardsToAll(t *testing.T) {
	cfg := config.LoggingConfig{
		Level:  "info",
		Format: "json",
		Output: "stderr",
	}
	// Setup installs a global JSON handler; we just verify it doesn't blow up
	// and the LevelVar is returned correctly.
	lv, shutdown, err := logging.Setup(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = shutdown(context.Background()) }()

	if lv == nil {
		t.Fatal("expected non-nil LevelVar")
	}
}

func TestMultiHandler_EnabledIfAnyEnabled(t *testing.T) {
	// A handler that is always disabled.
	disabled := slog.NewJSONHandler(nopWriter{}, &slog.HandlerOptions{
		Level: slog.LevelError + 100, // absurdly high
	})
	// A handler that accepts info.
	enabled := slog.NewJSONHandler(nopWriter{}, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})

	multi := logging.NewMultiHandler(disabled, enabled)
	if !multi.Enabled(context.Background(), slog.LevelInfo) {
		t.Error("MultiHandler.Enabled should be true when any inner handler is enabled")
	}
	if multi.Enabled(context.Background(), slog.LevelDebug) {
		t.Error("MultiHandler.Enabled should be false when no inner handler is enabled for Debug")
	}
}

// nopWriter discards all bytes.
type nopWriter struct{}

func (nopWriter) Write(p []byte) (int, error) { return len(p), nil }
