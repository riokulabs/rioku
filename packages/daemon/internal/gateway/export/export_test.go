package export

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWriteCSV_HeaderAndRows(t *testing.T) {
	ctx := context.Background()
	rows := []map[string]any{
		{"id": "r1", "actor": "alice", "when": time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)},
		{"id": "r2", "actor": "bob", "when": time.Date(2026, 4, 30, 10, 1, 0, 0, time.UTC)},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/audit/export/csv", nil).WithContext(ctx)
	if err := WriteCSV(rec, req, "audit.csv", []string{"id", "actor", "when"}, FromSlice(ctx, rows)); err != nil {
		t.Fatalf("WriteCSV: %v", err)
	}

	if got := rec.Header().Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, `audit.csv`) {
		t.Errorf("Content-Disposition = %q", got)
	}

	body := rec.Body.String()
	wantPrefix := "id,actor,when\n"
	if !strings.HasPrefix(body, wantPrefix) {
		t.Errorf("body should start with header row, got:\n%s", body)
	}
	if !strings.Contains(body, "r1,alice,2026-04-30T10:00:00Z\n") {
		t.Errorf("missing first row in body:\n%s", body)
	}
	if !strings.Contains(body, "r2,bob,2026-04-30T10:01:00Z\n") {
		t.Errorf("missing second row in body:\n%s", body)
	}
}

func TestWriteCSV_EmptySourceEmitsHeader(t *testing.T) {
	ctx := context.Background()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil).WithContext(ctx)
	if err := WriteCSV(rec, req, "empty.csv", []string{"a", "b"}, FromSlice(ctx, nil)); err != nil {
		t.Fatalf("WriteCSV: %v", err)
	}
	if rec.Body.String() != "a,b\n" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "a,b\n")
	}
}

func TestWriteJSONL(t *testing.T) {
	ctx := context.Background()
	rows := []map[string]any{
		{"id": "r1", "actor": "alice"},
		{"id": "r2", "actor": "bob"},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/audit/export/jsonl", nil).WithContext(ctx)
	if err := WriteJSONL(rec, req, "audit.jsonl", FromSlice(ctx, rows)); err != nil {
		t.Fatalf("WriteJSONL: %v", err)
	}

	if got := rec.Header().Get("Content-Type"); got != "application/x-ndjson; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}

	body := rec.Body.String()
	lines := strings.Split(strings.TrimRight(body, "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("got %d lines, want 2:\n%s", len(lines), body)
	}
	if !strings.Contains(lines[0], `"id":"r1"`) || !strings.Contains(lines[0], `"actor":"alice"`) {
		t.Errorf("first jsonl line wrong: %q", lines[0])
	}
	if !strings.Contains(lines[1], `"id":"r2"`) || !strings.Contains(lines[1], `"actor":"bob"`) {
		t.Errorf("second jsonl line wrong: %q", lines[1])
	}
}

func TestWriteCSV_HonoursContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	src := make(chan map[string]any)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil).WithContext(ctx)

	done := make(chan error, 1)
	go func() {
		done <- WriteCSV(rec, req, "x.csv", []string{"a"}, src)
	}()

	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Error("expected ctx error, got nil")
		}
	case <-time.After(time.Second):
		t.Fatal("WriteCSV did not return after ctx cancel")
	}
}

func TestToString_KnownTypes(t *testing.T) {
	now := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	cases := []struct {
		in   any
		want string
	}{
		{nil, ""},
		{"hello", "hello"},
		{[]byte("bytes"), "bytes"},
		{true, "true"},
		{false, "false"},
		{int(42), "42"},
		{int32(7), "7"},
		{int64(99), "99"},
		{float32(1.5), "1.5"},
		{float64(2.25), "2.25"},
		{now, "2026-04-30T10:00:00Z"},
	}
	for _, c := range cases {
		if got := toString(c.in); got != c.want {
			t.Errorf("toString(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}
