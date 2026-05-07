package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/observability"
)

// TestObservabilityRoutes_RequiresAuth confirms RegisterObservability
// Routes wraps the handler with the settings:read permission gate. An
// unauthenticated request must be rejected before the handler runs.
func TestObservabilityRoutes_RequiresAuth(t *testing.T) {
	mux := http.NewServeMux()
	RegisterObservabilityRoutes(mux, observability.NewJWKSRegistry(), nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/observability/jwks")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	// RequirePermission returns 401 when no session/bearer claims are
	// present in the context — this is the wired middleware speaking,
	// not the handler.
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (RequirePermission gate)", resp.StatusCode)
	}
}

func TestObservabilityRoutes_NilRegistry(t *testing.T) {
	mux := http.NewServeMux()
	// Register the handler directly (bypassing RequirePermission) so
	// this test exercises the nil-registry path; the auth wiring is
	// covered by TestObservabilityRoutes_RequiresAuth above.
	mux.Handle("GET /api/v1/observability/jwks",
		http.HandlerFunc(handleJWKSObservability(nil)))
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/observability/jwks")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var body jwksObservabilityResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Available {
		t.Error("Available should be false when registry is nil")
	}
	if body.Entries == nil || len(body.Entries) != 0 {
		t.Errorf("Entries = %#v, want non-nil empty slice", body.Entries)
	}
}

func TestObservabilityRoutes_ReadsRegistry(t *testing.T) {
	reg := observability.NewJWKSRegistry()
	reg.Register("https://idp.example/.well-known/jwks.json")
	reg.Record(observability.JWKSEvent{
		URL:    "https://idp.example/.well-known/jwks.json",
		Status: observability.JWKSStatusError,
		Error:  "dial tcp: i/o timeout",
		At:     time.Now().UTC(),
	})

	mux := http.NewServeMux()
	mux.Handle("GET /api/v1/observability/jwks",
		http.HandlerFunc(handleJWKSObservability(reg)))
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/observability/jwks")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var body jwksObservabilityResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.Available {
		t.Error("Available should be true with registry populated")
	}
	if len(body.Entries) != 1 {
		t.Fatalf("Entries len = %d, want 1", len(body.Entries))
	}
	e := body.Entries[0]
	if e.Status != observability.JWKSStatusError {
		t.Errorf("Status = %q, want %q", e.Status, observability.JWKSStatusError)
	}
	if e.LastError != "dial tcp: i/o timeout" {
		t.Errorf("LastError = %q", e.LastError)
	}
	if e.FailureCount != 1 {
		t.Errorf("FailureCount = %d, want 1", e.FailureCount)
	}
}
