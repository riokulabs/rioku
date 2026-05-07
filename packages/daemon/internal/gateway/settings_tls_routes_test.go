package gateway

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

func tlsTestEncodeBody(t *testing.T, body any) io.ReadCloser {
	t.Helper()
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		t.Fatalf("encode body: %v", err)
	}
	return io.NopCloser(&buf)
}

// generateSelfSignedCert produces a self-signed PEM cert + key pair for
// the given DNS name. Used by every test in this file — covers the
// "happy path" and gives mismatched-key tests a real cert to start from.
func generateSelfSignedCert(t *testing.T, cn string) (certPEM, keyPEM string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tmpl := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:              []string{cn},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}
	certPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	keyDER, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	keyPEM = string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))
	return
}

// TestSettingsTLS_ManualUploadHappyPath confirms POST /settings/tls/manual
// stores the cert, returns the documented {cert_id, sha256_fingerprint,
// expires_at, subject, sans} response, and triggers a Caddy reload.
func TestSettingsTLS_ManualUploadHappyPath(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsTLSRoutes(mux, drv)

	// Hook reload trigger so we can assert it fires.
	t.Cleanup(func() { SetCaddyReloadHook(nil) })
	var reloadReason string
	SetCaddyReloadHook(func(_ context.Context, reason string) error {
		reloadReason = reason
		return nil
	})

	certPEM, keyPEM := generateSelfSignedCert(t, "manual.example.com")

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/tls/manual", "default",
		map[string]any{"cert_pem": certPEM, "key_pem": keyPEM, "auto_renew": false}))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp manualCertResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.CertID == "" {
		t.Error("CertID empty")
	}
	if len(resp.SHA256Fingerprint) != 64 {
		t.Errorf("fingerprint len = %d, want 64 hex chars", len(resp.SHA256Fingerprint))
	}
	if resp.Subject == "" || resp.ExpiresAt == "" {
		t.Errorf("subject/expires empty: %+v", resp)
	}
	if len(resp.SANs) != 1 || resp.SANs[0] != "manual.example.com" {
		t.Errorf("SANs = %v", resp.SANs)
	}
	if reloadReason != "settings.tls.manual" {
		t.Errorf("reload reason = %q, want settings.tls.manual", reloadReason)
	}
}

// TestSettingsTLS_ManualUploadMalformedPEM rejects an obvious garbage
// payload before touching the store.
func TestSettingsTLS_ManualUploadMalformedPEM(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsTLSRoutes(mux, drv)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/tls/manual", "default",
		map[string]any{"cert_pem": "not a pem", "key_pem": "also not pem"}))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// TestSettingsTLS_ManualUploadMismatchedKey rejects a real cert paired
// with a key that doesn't sign it.
func TestSettingsTLS_ManualUploadMismatchedKey(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsTLSRoutes(mux, drv)

	certPEM, _ := generateSelfSignedCert(t, "a.example.com")
	_, otherKey := generateSelfSignedCert(t, "b.example.com")

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/tls/manual", "default",
		map[string]any{"cert_pem": certPEM, "key_pem": otherKey}))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// TestSettingsTLS_ManualUploadViewerForbidden confirms RequirePermission
// blocks anyone without `tls:write`.
func TestSettingsTLS_ManualUploadViewerForbidden(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsTLSRoutes(mux, drv)

	certPEM, keyPEM := generateSelfSignedCert(t, "viewer.example.com")

	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/t/default/settings/tls/manual", nil)
	body := tlsTestEncodeBody(t, map[string]any{"cert_pem": certPEM, "key_pem": keyPEM})
	req.Body = body
	req.Header.Set("Content-Type", "application/json")
	// Viewer claims — no tls:write.
	claims := &auth.SessionClaims{
		SessionID: "s", UserID: "u", Username: "v",
		Roles: []string{"viewer"}, Scopes: []string{"tls:read"},
	}
	ctx := auth.WithSessionClaims(req.Context(), claims)
	tx, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	tn, _ := tx.GetTenantBySlug(ctx, "default")
	_ = tx.Rollback()
	ctx = WithTenant(ctx, tn)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
}

// TestSettingsTLS_ManualDeleteHappyAndNotFound covers DELETE happy path
// (after upload) and a 404 for an unknown id.
func TestSettingsTLS_ManualDeleteHappyAndNotFound(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsTLSRoutes(mux, drv)

	// 404 first — nothing to delete yet.
	rec404 := httptest.NewRecorder()
	mux.ServeHTTP(rec404, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/settings/tls/manual/missing-id", "default", nil))
	if rec404.Code != http.StatusNotFound {
		t.Errorf("missing id: status = %d, want 404", rec404.Code)
	}

	// Upload then delete.
	certPEM, keyPEM := generateSelfSignedCert(t, "del.example.com")
	recUp := httptest.NewRecorder()
	mux.ServeHTTP(recUp, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/settings/tls/manual", "default",
		map[string]any{"cert_pem": certPEM, "key_pem": keyPEM}))
	if recUp.Code != http.StatusCreated {
		t.Fatalf("upload: status = %d", recUp.Code)
	}
	var up manualCertResponse
	_ = json.NewDecoder(recUp.Body).Decode(&up)

	recDel := httptest.NewRecorder()
	mux.ServeHTTP(recDel, authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/settings/tls/manual/"+up.CertID, "default", nil))
	if recDel.Code != http.StatusNoContent {
		t.Errorf("delete: status = %d, want 204", recDel.Code)
	}
}
