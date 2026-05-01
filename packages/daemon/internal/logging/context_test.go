package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestContext_RequestIDRoundTrip(t *testing.T) {
	ctx := context.Background()
	if got := RequestIDFromContext(ctx); got != "" {
		t.Errorf("empty ctx returned %q, want empty", got)
	}
	ctx = WithRequestID(ctx, "req_abc")
	if got := RequestIDFromContext(ctx); got != "req_abc" {
		t.Errorf("got %q, want req_abc", got)
	}
}

func TestContext_TraceIDRoundTrip(t *testing.T) {
	ctx := WithTraceID(context.Background(), "0af7651916cd43dd8448eb211c80319c")
	if got := TraceIDFromContext(ctx); got != "0af7651916cd43dd8448eb211c80319c" {
		t.Errorf("trace id round-trip mismatch: %q", got)
	}
}

func TestContext_ComponentRoundTrip(t *testing.T) {
	ctx := WithComponent(context.Background(), "gateway")
	if got := ComponentFromContext(ctx); got != "gateway" {
		t.Errorf("component round-trip mismatch: %q", got)
	}
}

func TestContext_EmptyValuesAreNoOps(t *testing.T) {
	parent := context.Background()
	if WithRequestID(parent, "") != parent {
		t.Error("WithRequestID('') should return parent ctx unchanged")
	}
	if WithTraceID(parent, "") != parent {
		t.Error("WithTraceID('') should return parent ctx unchanged")
	}
	if WithComponent(parent, "") != parent {
		t.Error("WithComponent('') should return parent ctx unchanged")
	}
}

func TestContext_NilContextSafe(t *testing.T) {
	// All getters must tolerate a nil context (defensive — slog itself
	// can pass context.TODO but we want to avoid a panic if anyone
	// hands us literal nil).
	if RequestIDFromContext(nil) != "" { //nolint:staticcheck // intentionally testing the nil-guard branch
		t.Error("RequestIDFromContext(nil) should return empty")
	}
	if TraceIDFromContext(nil) != "" { //nolint:staticcheck // intentionally testing the nil-guard branch
		t.Error("TraceIDFromContext(nil) should return empty")
	}
	if ComponentFromContext(nil) != "" { //nolint:staticcheck // intentionally testing the nil-guard branch
		t.Error("ComponentFromContext(nil) should return empty")
	}
}

// ─── ContextHandler ─────────────────────────────────────────────────────────

func TestContextHandler_AddsAttrsFromContext(t *testing.T) {
	var buf bytes.Buffer
	h := NewContextHandler(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	logger := slog.New(h)

	ctx := WithRequestID(context.Background(), "req_xyz")
	ctx = WithTraceID(ctx, "0af7651916cd43dd8448eb211c80319c")
	ctx = WithComponent(ctx, "gateway")

	logger.InfoContext(ctx, "test message", "extra", "value")

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("unmarshal log line: %v\nbuf: %s", err, buf.String())
	}
	if entry["request_id"] != "req_xyz" {
		t.Errorf("missing request_id: %v", entry)
	}
	if entry["trace_id"] != "0af7651916cd43dd8448eb211c80319c" {
		t.Errorf("missing trace_id: %v", entry)
	}
	if entry["component"] != "gateway" {
		t.Errorf("missing component: %v", entry)
	}
	if entry["extra"] != "value" {
		t.Errorf("dropped caller-supplied attr: %v", entry)
	}
	if entry["msg"] != "test message" {
		t.Errorf("wrong msg: %v", entry)
	}
}

func TestContextHandler_OmitsMissingKeys(t *testing.T) {
	var buf bytes.Buffer
	h := NewContextHandler(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	logger := slog.New(h)

	logger.InfoContext(context.Background(), "no ctx attrs")

	out := buf.String()
	if strings.Contains(out, "request_id") || strings.Contains(out, "trace_id") || strings.Contains(out, "component") {
		t.Errorf("unexpected ctx attrs in: %s", out)
	}
}

func TestContextHandler_PreservesWithAttrsAndGroup(t *testing.T) {
	var buf bytes.Buffer
	h := NewContextHandler(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	logger := slog.New(h).With("static_attr", "yes")

	ctx := WithRequestID(context.Background(), "req_with")
	logger.InfoContext(ctx, "msg")

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, buf.String())
	}
	if entry["static_attr"] != "yes" {
		t.Errorf("With() attr lost: %v", entry)
	}
	if entry["request_id"] != "req_with" {
		t.Errorf("request_id missing: %v", entry)
	}
}

func TestContextHandler_EnabledDelegates(t *testing.T) {
	inner := slog.NewJSONHandler(&bytes.Buffer{}, &slog.HandlerOptions{Level: slog.LevelWarn})
	h := NewContextHandler(inner)
	if h.Enabled(context.Background(), slog.LevelDebug) {
		t.Error("expected debug disabled when inner is warn-only")
	}
	if !h.Enabled(context.Background(), slog.LevelError) {
		t.Error("expected error enabled")
	}
}
