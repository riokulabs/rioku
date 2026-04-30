package optionsutil

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRegister_AllowHeader(t *testing.T) {
	mux := http.NewServeMux()
	Register(mux, "/api/v1/things", []string{"GET", "POST"})

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/things", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", rec.Code)
	}
	if got, want := rec.Header().Get("Allow"), "GET, OPTIONS, POST"; got != want {
		t.Errorf("Allow = %q, want %q", got, want)
	}
	if got := rec.Header().Get("Accept-Patch"); got != AcceptPatchValue {
		t.Errorf("Accept-Patch = %q, want %q", got, AcceptPatchValue)
	}
	if got := rec.Header().Get("X-Rioku-Capabilities"); got != CapabilitiesValue {
		t.Errorf("X-Rioku-Capabilities = %q, want %q", got, CapabilitiesValue)
	}
}

func TestRegister_DedupesAndSorts(t *testing.T) {
	mux := http.NewServeMux()
	// Duplicates, lowercase, with whitespace — buildAllow should normalise.
	Register(mux, "/x", []string{"get", "POST", "GET", " patch "})

	req := httptest.NewRequest(http.MethodOptions, "/x", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if got, want := rec.Header().Get("Allow"), "GET, OPTIONS, PATCH, POST"; got != want {
		t.Errorf("Allow = %q, want %q", got, want)
	}
}

func TestRegister_WithItemPath(t *testing.T) {
	mux := http.NewServeMux()
	Register(mux, "/api/v1/things/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/things/abc", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", rec.Code)
	}
	if got, want := rec.Header().Get("Allow"), "DELETE, GET, OPTIONS, PATCH, PUT"; got != want {
		t.Errorf("Allow = %q, want %q", got, want)
	}
}

func TestRegisterWithCapabilities_AppendsExtras(t *testing.T) {
	mux := http.NewServeMux()
	RegisterWithCapabilities(mux, "/api/v1/audit", []string{"GET"}, []string{"sse", "export-csv"})

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/audit", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	want := CapabilitiesValue + ", sse, export-csv"
	if got := rec.Header().Get("X-Rioku-Capabilities"); got != want {
		t.Errorf("X-Rioku-Capabilities = %q, want %q", got, want)
	}
}

func TestRegister_OnlyOptionsMethodMatches(t *testing.T) {
	mux := http.NewServeMux()
	Register(mux, "/api/v1/things", []string{"GET"})

	// A GET should fall through to mux's not-found / method-mismatch
	// handling — we never registered a GET handler. With Go 1.22 mux,
	// unknown method on a known path → 405; unknown path → 404.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/things", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET should 405 (only OPTIONS registered), got %d", rec.Code)
	}
}
