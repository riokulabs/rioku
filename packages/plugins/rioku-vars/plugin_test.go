package riokuvars

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

var nextCapture = func(captured *http.Request) caddyhttp.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		*captured = *r
		w.WriteHeader(http.StatusOK)
		return nil
	}
}

func TestServeHTTP_SetsHeadersWhenNonEmpty(t *testing.T) {
	h := Handler{RouteID: "route_abc", ServiceID: "svc_xyz"}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	var captured http.Request

	if err := h.ServeHTTP(w, req, nextCapture(&captured)); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}

	if got := req.Header.Get("X-Rioku-Route"); got != "route_abc" {
		t.Errorf("X-Rioku-Route = %q, want %q", got, "route_abc")
	}
	if got := req.Header.Get("X-Rioku-Service"); got != "svc_xyz" {
		t.Errorf("X-Rioku-Service = %q, want %q", got, "svc_xyz")
	}
}

func TestServeHTTP_OmitsHeadersWhenEmpty(t *testing.T) {
	h := Handler{} // no RouteID or ServiceID

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	var captured http.Request

	if err := h.ServeHTTP(w, req, nextCapture(&captured)); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}

	if v := req.Header.Get("X-Rioku-Route"); v != "" {
		t.Errorf("X-Rioku-Route should be absent, got %q", v)
	}
	if v := req.Header.Get("X-Rioku-Service"); v != "" {
		t.Errorf("X-Rioku-Service should be absent, got %q", v)
	}
}

func TestServeHTTP_PartialIDs(t *testing.T) {
	h := Handler{RouteID: "route_123"} // ServiceID intentionally empty

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	var captured http.Request

	if err := h.ServeHTTP(w, req, nextCapture(&captured)); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}

	if got := req.Header.Get("X-Rioku-Route"); got != "route_123" {
		t.Errorf("X-Rioku-Route = %q, want %q", got, "route_123")
	}
	if v := req.Header.Get("X-Rioku-Service"); v != "" {
		t.Errorf("X-Rioku-Service should be absent, got %q", v)
	}
}
