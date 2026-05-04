package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/caddy"
)

// fakeCertService — mirror of fakeClusterService for exercising the cert
// routes in handler isolation.
type fakeCertService struct {
	certs       []caddy.Certificate
	renewErr    error
	revokeErr   error
	renewCalls  atomic.Int64
	revokeCalls atomic.Int64
	lastID      atomic.Value // string
}

func (f *fakeCertService) ListCertificates(_ context.Context) ([]caddy.Certificate, error) {
	return f.certs, nil
}

func (f *fakeCertService) RenewCertificate(_ context.Context, id string) (caddy.CertActionResult, error) {
	f.renewCalls.Add(1)
	f.lastID.Store(id)
	if f.renewErr != nil {
		return caddy.CertActionResult{}, f.renewErr
	}
	return caddy.CertActionResult{StartedAt: time.Now().UTC(), Note: "ok"}, nil
}

func (f *fakeCertService) RevokeCertificate(_ context.Context, id string) (caddy.CertActionResult, error) {
	f.revokeCalls.Add(1)
	f.lastID.Store(id)
	if f.revokeErr != nil {
		return caddy.CertActionResult{}, f.revokeErr
	}
	return caddy.CertActionResult{StartedAt: time.Now().UTC(), Note: "ok"}, nil
}

func newTestCertService() *fakeCertService {
	return &fakeCertService{
		certs: []caddy.Certificate{
			{
				ID:             "fp-1",
				Domain:         "example.com",
				SANs:           []string{"example.com", "www.example.com"},
				Issuer:         "Let's Encrypt R3",
				Serial:         "abc123",
				FingerprintSHA: "fp-1",
				NotBefore:      time.Now().UTC().Add(-30 * 24 * time.Hour),
				NotAfter:       time.Now().UTC().Add(60 * 24 * time.Hour),
				Status:         caddy.CertStatusActive,
				AutoRenew:      true,
				ManagedByCaddy: true,
				ACMEDirectory:  "https://acme-v02.api.letsencrypt.org/directory",
			},
		},
	}
}

func TestCertRoutes_List(t *testing.T) {
	svc := newTestCertService()
	mux := http.NewServeMux()
	RegisterCertificateRoutes(mux, svc)

	req := authedRequest(http.MethodGet, "/api/v1/certificates", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		Items []caddy.Certificate `json:"items"`
		Total int                 `json:"total"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Total != 1 || len(body.Items) != 1 {
		t.Errorf("expected 1 cert, got total=%d len=%d", body.Total, len(body.Items))
	}
	if body.Items[0].Domain != "example.com" {
		t.Errorf("domain mismatch: %s", body.Items[0].Domain)
	}
}

func TestCertRoutes_Renew(t *testing.T) {
	svc := newTestCertService()
	mux := http.NewServeMux()
	RegisterCertificateRoutes(mux, svc)

	req := authedRequest(http.MethodPost, "/api/v1/certificates/fp-1/renew", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}
	if svc.renewCalls.Load() != 1 {
		t.Errorf("expected 1 renew call, got %d", svc.renewCalls.Load())
	}
	if got, _ := svc.lastID.Load().(string); got != "fp-1" {
		t.Errorf("expected fp-1 id, got %q", got)
	}
}

func TestCertRoutes_RenewNotFound(t *testing.T) {
	svc := newTestCertService()
	svc.renewErr = caddy.ErrCertNotFound
	mux := http.NewServeMux()
	RegisterCertificateRoutes(mux, svc)

	req := authedRequest(http.MethodPost, "/api/v1/certificates/missing/renew", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestCertRoutes_Revoke(t *testing.T) {
	svc := newTestCertService()
	mux := http.NewServeMux()
	RegisterCertificateRoutes(mux, svc)

	req := authedRequest(http.MethodPost, "/api/v1/certificates/fp-1/revoke", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}
	if svc.revokeCalls.Load() != 1 {
		t.Errorf("expected 1 revoke call, got %d", svc.revokeCalls.Load())
	}
}

func TestCertRoutes_RevokeNotFound(t *testing.T) {
	svc := newTestCertService()
	svc.revokeErr = caddy.ErrCertNotFound
	mux := http.NewServeMux()
	RegisterCertificateRoutes(mux, svc)

	req := authedRequest(http.MethodPost, "/api/v1/certificates/missing/revoke", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestCertRoutes_NilServiceSkipsRegistration(t *testing.T) {
	mux := http.NewServeMux()
	RegisterCertificateRoutes(mux, nil)

	req := authedRequest(http.MethodGet, "/api/v1/certificates", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404 with nil svc, got %d", rec.Code)
	}
}

// Stub integration through the HTTP layer.
func TestCertRoutes_StubIntegration(t *testing.T) {
	svc := caddy.NewStubCertService()
	mux := http.NewServeMux()
	RegisterCertificateRoutes(mux, svc)

	req := authedRequest(http.MethodGet, "/api/v1/certificates", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d", rec.Code)
	}
	var body struct {
		Total int `json:"total"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body.Total != 0 {
		t.Errorf("expected 0 from stub, got %d", body.Total)
	}

	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, authedRequest(http.MethodPost, "/api/v1/certificates/anything/renew", nil))
	if rec2.Code != http.StatusAccepted {
		t.Errorf("expected 202 from stub renew, got %d", rec2.Code)
	}
}
