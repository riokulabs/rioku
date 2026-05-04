package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/riokulabs/rioku/internal/config"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ---------------------------------------------------------------------------
// Security Headers
// ---------------------------------------------------------------------------

func TestSecurityHeaders_APIPath(t *testing.T) {
	handler := SecurityHeadersMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	checks := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"X-XSS-Protection":       "0",
		"Referrer-Policy":        "strict-origin-when-cross-origin",
		"Permissions-Policy":     "camera=(), microphone=(), geolocation=()",
	}
	for header, want := range checks {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("header %s: got %q, want %q", header, got, want)
		}
	}

	// CSP must be set for /api/ paths.
	csp := rec.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Error("expected Content-Security-Policy header on /api/ path, got none")
	}
	if !strings.Contains(csp, "default-src 'none'") {
		t.Errorf("unexpected CSP value: %q", csp)
	}
}

func TestSecurityHeaders_NonAPIPath(t *testing.T) {
	handler := SecurityHeadersMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/dashboard", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Core security headers must still be set.
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options: got %q, want nosniff", got)
	}
	if got := rec.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Errorf("X-Frame-Options: got %q, want DENY", got)
	}

	// CSP must NOT be set for non-/api/ paths.
	if csp := rec.Header().Get("Content-Security-Policy"); csp != "" {
		t.Errorf("expected no Content-Security-Policy on non-API path, got %q", csp)
	}
}

// ---------------------------------------------------------------------------
// CORS Middleware
// ---------------------------------------------------------------------------

func newCORSConfig(origins ...string) config.CORSConfig {
	return config.CORSConfig{
		AllowedOrigins: origins,
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization", "X-Request-ID"},
		MaxAge:         3600,
	}
}

func TestCORSMiddleware_AllowedOrigin(t *testing.T) {
	cfg := newCORSConfig("https://app.rioku.dev")
	handler := CORSMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.Header.Set("Origin", "https://app.rioku.dev")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.rioku.dev" {
		t.Errorf("Access-Control-Allow-Origin: got %q, want https://app.rioku.dev", got)
	}
	if got := rec.Header().Get("Vary"); got != "Origin" {
		t.Errorf("Vary: got %q, want Origin", got)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status: got %d, want 200", rec.Code)
	}
}

func TestCORSMiddleware_DisallowedOrigin(t *testing.T) {
	cfg := newCORSConfig("https://app.rioku.dev")
	handler := CORSMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("expected no Access-Control-Allow-Origin for disallowed origin, got %q", got)
	}
	// Request must still be passed through.
	if rec.Code != http.StatusOK {
		t.Errorf("status: got %d, want 200", rec.Code)
	}
}

func TestCORSMiddleware_Preflight(t *testing.T) {
	cfg := newCORSConfig("https://app.rioku.dev")
	// CORS now sets preflight headers and falls through to the
	// resource's OPTIONS handler so the resource can advertise its
	// `Allow` set. We simulate the resource handler returning 204.
	handler := CORSMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.Header().Set("Allow", "GET, POST, OPTIONS")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/routes", nil)
	req.Header.Set("Origin", "https://app.rioku.dev")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "Content-Type")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("preflight status: got %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Error("expected Access-Control-Allow-Methods, got none")
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); got == "" {
		t.Error("expected Access-Control-Allow-Headers, got none")
	}
	if got := rec.Header().Get("Access-Control-Max-Age"); got == "" {
		t.Error("expected Access-Control-Max-Age, got none")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.rioku.dev" {
		t.Errorf("Access-Control-Allow-Origin: got %q, want https://app.rioku.dev", got)
	}
	if got := rec.Header().Get("Allow"); got != "GET, POST, OPTIONS" {
		t.Errorf("Allow: got %q, want resource-supplied", got)
	}
}

func TestCORSMiddleware_NoOrigin(t *testing.T) {
	cfg := newCORSConfig("https://app.rioku.dev")
	innerCalled := false
	handler := CORSMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		innerCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	// No Origin header.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !innerCalled {
		t.Error("expected inner handler to be called when no Origin header")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("expected no CORS headers without Origin, got %q", got)
	}
}

func TestCORSMiddleware_WildcardOrigin(t *testing.T) {
	cfg := newCORSConfig("*")
	handler := CORSMiddleware(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/routes", nil)
	req.Header.Set("Origin", "https://any-origin.example.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://any-origin.example.com" {
		t.Errorf("wildcard: Access-Control-Allow-Origin: got %q, want https://any-origin.example.com", got)
	}
}

// ---------------------------------------------------------------------------
// Request ID Middleware
// ---------------------------------------------------------------------------

func TestRequestIDMiddleware_Generated(t *testing.T) {
	handler := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	id := rec.Header().Get("X-Request-ID")
	if id == "" {
		t.Fatal("expected X-Request-ID to be set, got empty")
	}
	if !strings.HasPrefix(id, "req_") {
		t.Errorf("generated X-Request-ID should start with req_, got %q", id)
	}
}

func TestRequestIDMiddleware_Passthrough(t *testing.T) {
	handler := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	req.Header.Set("X-Request-ID", "test-123")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Request-ID"); got != "test-123" {
		t.Errorf("X-Request-ID passthrough: got %q, want test-123", got)
	}
}

// ---------------------------------------------------------------------------
// Error Handler
// ---------------------------------------------------------------------------

func callErrorHandler(t *testing.T, grpcErr error) *httptest.ResponseRecorder {
	t.Helper()
	mux := runtime.NewServeMux()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	rec := httptest.NewRecorder()
	ErrorHandler(context.Background(), mux, nil, rec, req, grpcErr)
	return rec
}

func decodeProblem(t *testing.T, rec *httptest.ResponseRecorder) ProblemDetail {
	t.Helper()
	var p ProblemDetail
	if err := json.NewDecoder(rec.Body).Decode(&p); err != nil {
		t.Fatalf("failed to decode ProblemDetail: %v", err)
	}
	return p
}

func TestErrorHandler_4xx(t *testing.T) {
	rec := callErrorHandler(t, status.Error(codes.InvalidArgument, "field X is required"))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type: got %q, want application/problem+json", ct)
	}

	p := decodeProblem(t, rec)
	if p.Status != 400 {
		t.Errorf("ProblemDetail.Status: got %d, want 400", p.Status)
	}
	if p.Detail != "field X is required" {
		t.Errorf("ProblemDetail.Detail: got %q, want original error message", p.Detail)
	}
	if p.Type == "" {
		t.Error("ProblemDetail.Type must not be empty")
	}
}

func TestErrorHandler_5xx(t *testing.T) {
	rec := callErrorHandler(t, status.Error(codes.Internal, "database connection pool exhausted"))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status: got %d, want 500", rec.Code)
	}

	p := decodeProblem(t, rec)
	if p.Status != 500 {
		t.Errorf("ProblemDetail.Status: got %d, want 500", p.Status)
	}
	// Internal details must never be exposed — check sanitization.
	if strings.Contains(p.Detail, "database") || strings.Contains(p.Detail, "connection pool") {
		t.Errorf("5xx detail must be sanitized, got %q", p.Detail)
	}
	if !strings.Contains(p.Detail, "Reference:") {
		t.Errorf("5xx detail should contain request reference, got %q", p.Detail)
	}
}

func TestErrorHandler_401(t *testing.T) {
	rec := callErrorHandler(t, status.Error(codes.Unauthenticated, "token expired"))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d, want 401", rec.Code)
	}
	if got := rec.Header().Get("WWW-Authenticate"); got != "Bearer" {
		t.Errorf("WWW-Authenticate: got %q, want Bearer", got)
	}
}

func TestErrorHandler_429(t *testing.T) {
	rec := callErrorHandler(t, status.Error(codes.ResourceExhausted, "too many requests"))

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("status: got %d, want 429", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got == "" {
		t.Error("expected Retry-After header on 429 response")
	}
}

func TestErrorHandler_UnknownCode(t *testing.T) {
	// Use a gRPC code that has no explicit mapping — falls back to 500.
	rec := callErrorHandler(t, status.Error(codes.DataLoss, "some data loss"))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("unknown gRPC code: got %d, want 500", rec.Code)
	}

	p := decodeProblem(t, rec)
	if p.Status != 500 {
		t.Errorf("ProblemDetail.Status: got %d, want 500", p.Status)
	}
}

// ---------------------------------------------------------------------------
// Body Limit Middleware
// ---------------------------------------------------------------------------

func TestBodyLimitMiddleware_Under(t *testing.T) {
	const maxBytes = 1024
	handler := BodyLimitMiddleware(maxBytes)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	body := strings.NewReader(strings.Repeat("x", 512))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/routes", body)
	req.ContentLength = 512
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("under-limit body: got %d, want 200", rec.Code)
	}
}

func TestBodyLimitMiddleware_Over(t *testing.T) {
	const maxBytes = 1024
	handler := BodyLimitMiddleware(maxBytes)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Should not be reached.
		w.WriteHeader(http.StatusOK)
	}))

	body := strings.NewReader(strings.Repeat("x", 2048))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/routes", body)
	req.ContentLength = 2048 // explicitly over limit
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("over-limit body: got %d, want 413", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type: got %q, want application/problem+json", ct)
	}
}

func TestBodyLimitMiddleware_StreamingBypass(t *testing.T) {
	const maxBytes = 1 // extremely small limit to ensure bypass is the cause
	innerCalled := false
	handler := BodyLimitMiddleware(maxBytes)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		innerCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	body := strings.NewReader(strings.Repeat("x", 4096))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events/stream", body)
	req.ContentLength = 4096
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !innerCalled {
		t.Error("expected inner handler to be called for /api/v1/events (streaming bypass)")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("streaming bypass: got %d, want 200", rec.Code)
	}
}
