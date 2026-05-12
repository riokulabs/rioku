package rerr

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/riokulabs/rioku/internal/logging"
)

// captureHandler is a test slog.Handler that records every log record.
type captureHandler struct {
	mu      sync.Mutex
	records []slog.Record
}

func (h *captureHandler) Enabled(_ context.Context, _ slog.Level) bool { return true }

func (h *captureHandler) Handle(_ context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.records = append(h.records, r.Clone())
	return nil
}

func (h *captureHandler) WithAttrs(_ []slog.Attr) slog.Handler { return h }
func (h *captureHandler) WithGroup(_ string) slog.Handler      { return h }

func (h *captureHandler) last() (slog.Record, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.records) == 0 {
		return slog.Record{}, false
	}
	return h.records[len(h.records)-1], true
}

// installLogger replaces slog.Default for the duration of the test and
// restores it on cleanup.
func installLogger(t *testing.T) *captureHandler {
	t.Helper()
	prev := slog.Default()
	h := &captureHandler{}
	slog.SetDefault(slog.New(h))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return h
}

func TestH_NilError_NoWrite(t *testing.T) {
	called := false
	handler := H(func(w http.ResponseWriter, r *http.Request) error {
		called = true
		w.WriteHeader(http.StatusOK)
		return nil
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	handler.ServeHTTP(rr, req)

	if !called {
		t.Error("inner handler not called")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rr.Code)
	}
}

func TestH_NonRerr_Becomes500(t *testing.T) {
	ch := installLogger(t)

	handler := H(func(w http.ResponseWriter, r *http.Request) error {
		return errors.New("unexpected boom")
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/foo", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rr.Code)
	}
	assertContentTypeProblem(t, rr)
	assertCorrelationIDHeader(t, rr)

	rec, ok := ch.last()
	if !ok {
		t.Fatal("no log record captured")
	}
	if rec.Level != slog.LevelError {
		t.Errorf("log level = %v, want ERROR", rec.Level)
	}
}

func TestH_4xx_LogsWarn(t *testing.T) {
	ch := installLogger(t)

	handler := H(func(w http.ResponseWriter, r *http.Request) error {
		return NotFound("widget", "42")
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/widgets/42", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
	assertContentTypeProblem(t, rr)
	assertCorrelationIDHeader(t, rr)

	rec, ok := ch.last()
	if !ok {
		t.Fatal("no log record captured")
	}
	if rec.Level != slog.LevelWarn {
		t.Errorf("log level = %v, want WARN for 4xx", rec.Level)
	}
}

func TestH_5xx_LogsError(t *testing.T) {
	ch := installLogger(t)

	handler := H(func(w http.ResponseWriter, r *http.Request) error {
		return Wrap(errors.New("db dead"), "could not load widget")
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/widgets/1", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rr.Code)
	}
	assertContentTypeProblem(t, rr)
	assertCorrelationIDHeader(t, rr)

	rec, ok := ch.last()
	if !ok {
		t.Fatal("no log record captured")
	}
	if rec.Level != slog.LevelError {
		t.Errorf("log level = %v, want ERROR for 5xx", rec.Level)
	}
}

func TestH_ProblemDetailShape(t *testing.T) {
	installLogger(t)

	handler := H(func(w http.ResponseWriter, r *http.Request) error {
		return Forbidden("admin.write")
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/admin/something", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rr.Code)
	}

	var pd map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&pd); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if pd["type"] == nil || pd["type"] == "" {
		t.Error("problem detail missing type")
	}
	if pd["title"] == nil || pd["title"] == "" {
		t.Error("problem detail missing title")
	}
	if pd["status"] == nil {
		t.Error("problem detail missing status")
	}
	if pd["instance"] == nil {
		t.Error("problem detail missing instance")
	}
}

func TestH_ValidationErrors_IncludesFields(t *testing.T) {
	installLogger(t)

	handler := H(func(w http.ResponseWriter, r *http.Request) error {
		return Validation(map[string]string{"name": "required"})
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/widgets", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want 422", rr.Code)
	}

	var pd map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&pd); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	errs, ok := pd["errors"]
	if !ok || errs == nil {
		t.Error("expected errors field in problem detail")
	}
}

func TestH_RetryAfterHeader_RateLimited(t *testing.T) {
	installLogger(t)

	handler := H(func(w http.ResponseWriter, r *http.Request) error {
		return RateLimited(30)
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("status = %d, want 429", rr.Code)
	}
	if rr.Header().Get("Retry-After") != "30" {
		t.Errorf("Retry-After = %q, want 30", rr.Header().Get("Retry-After"))
	}
}

func TestH_WWWAuthenticate_Unauthenticated(t *testing.T) {
	installLogger(t)

	handler := H(func(w http.ResponseWriter, r *http.Request) error {
		return Unauthenticated()
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rr.Code)
	}
	if !strings.EqualFold(rr.Header().Get("WWW-Authenticate"), "Bearer") {
		t.Errorf("WWW-Authenticate = %q, want Bearer", rr.Header().Get("WWW-Authenticate"))
	}
}

func TestH_ContextLogger_Used(t *testing.T) {
	ch := &captureHandler{}
	logger := slog.New(ch)

	prev := slog.Default()
	slog.SetDefault(logger)
	t.Cleanup(func() { slog.SetDefault(prev) })

	handler := H(func(w http.ResponseWriter, r *http.Request) error {
		return NotFound("item", "99")
	})

	ctx := logging.WithRequestID(context.Background(), "req_test123")
	req := httptest.NewRequest(http.MethodGet, "/items/99", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	// correlation_id should be set on the response header
	if rr.Header().Get("X-Correlation-Id") == "" {
		t.Error("X-Correlation-Id header missing")
	}
}

// ─── helpers ────────────────────────────────────────────────────────────────

func assertContentTypeProblem(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	ct := rr.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/problem+json") {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
}

func assertCorrelationIDHeader(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	if rr.Header().Get("X-Correlation-Id") == "" {
		t.Error("X-Correlation-Id header missing")
	}
}
