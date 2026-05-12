package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"
)

func TestFrom_NilContext(t *testing.T) {
	log := From(nil) //nolint:staticcheck // intentionally testing the nil-guard branch
	if log == nil {
		t.Error("From(nil) returned nil logger")
	}
}

func TestFrom_EmptyContext(t *testing.T) {
	log := From(context.Background())
	if log == nil {
		t.Error("From(context.Background()) returned nil logger")
	}
}

func TestFrom_FullContext(t *testing.T) {
	var buf bytes.Buffer
	h := NewContextHandler(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	prev := slog.Default()
	slog.SetDefault(slog.New(h))
	t.Cleanup(func() { slog.SetDefault(prev) })

	ctx := WithRequestID(context.Background(), "req_fromtest")
	ctx = WithTraceID(ctx, "abc123def456abc123def456abc12345")
	ctx = WithComponent(ctx, "test-component")

	log := From(ctx)
	if log == nil {
		t.Fatal("From returned nil")
	}
	log.Info("test message")

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("unmarshal log: %v\nbuf: %s", err, buf.String())
	}
	if entry["request_id"] != "req_fromtest" {
		t.Errorf("request_id missing or wrong: %v", entry)
	}
	if entry["trace_id"] != "abc123def456abc123def456abc12345" {
		t.Errorf("trace_id missing or wrong: %v", entry)
	}
	if entry["component"] != "test-component" {
		t.Errorf("component missing or wrong: %v", entry)
	}
}

func TestFrom_PartialContext(t *testing.T) {
	var buf bytes.Buffer
	h := NewContextHandler(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	prev := slog.Default()
	slog.SetDefault(slog.New(h))
	t.Cleanup(func() { slog.SetDefault(prev) })

	// Only request_id set; trace_id and component absent.
	ctx := WithRequestID(context.Background(), "req_partial")

	log := From(ctx)
	log.Info("partial test")

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("unmarshal log: %v\nbuf: %s", err, buf.String())
	}
	if entry["request_id"] != "req_partial" {
		t.Errorf("request_id missing: %v", entry)
	}
	// trace_id should not appear.
	if _, ok := entry["trace_id"]; ok {
		t.Errorf("unexpected trace_id in partial context: %v", entry)
	}
}
