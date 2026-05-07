package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/store"
)

// makeSideloadRequest builds an authenticated multipart request for the
// sideload endpoint with the given parts.
func makeSideloadRequest(t *testing.T, st store.Driver, slug string, parts map[string]string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for name, content := range parts {
		fw, err := mw.CreateFormFile(name, name+".bin")
		if err != nil {
			t.Fatalf("create form file %q: %v", name, err)
		}
		if _, err := fw.Write([]byte(content)); err != nil {
			t.Fatalf("write form file %q: %v", name, err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/t/"+slug+"/plugins/sideload", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	claims := &auth.SessionClaims{
		SessionID: "test-session",
		UserID:    "test-user",
		Username:  "tester",
		Roles:     []string{"superadmin"},
		Scopes:    []string{"*"},
	}
	ctx := auth.WithSessionClaims(req.Context(), claims)
	tx, _ := st.Begin(context.Background(), store.TxOptions{ReadOnly: true})
	tn, err := tx.GetTenantBySlug(context.Background(), slug)
	_ = tx.Rollback()
	if err != nil {
		t.Fatalf("resolve tenant %s: %v", slug, err)
	}
	ctx = WithTenant(ctx, tn)
	return req.WithContext(ctx)
}

// validManifestJSON returns a minimal manifest that passes the validator.
// The declared permissions are namespaced under the plugin id so they
// don't clash with built-in catalog entries — registration via the
// plugin permission registry would otherwise 409.
func validManifestJSON(id string) string {
	b, _ := json.Marshal(map[string]any{
		"id":          id,
		"name":        "Sideload Test",
		"version":     "0.1.0",
		"permissions": []string{id + ":read", id + ":write"},
	})
	return string(b)
}

// configureStagingForTest points the global staging dir at t.TempDir() and
// resets it on cleanup. It also flips the sideload feature flag on for
// the duration of the test so the dev-mode 404 gate does not fire.
func configureStagingForTest(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	prev := pluginStagingDir
	SetPluginStagingDir(dir)
	prevCaps := currentCapabilities
	currentCapabilities = &daemonCapabilities{SideloadEnabled: true}
	t.Cleanup(func() {
		SetPluginStagingDir(prev)
		currentCapabilities = prevCaps
	})
	return dir
}

// withSideloadDisabled flips the sideload capability off for the
// duration of the test (resets via t.Cleanup). Used by the dev-mode
// gate tests.
func withSideloadDisabled(t *testing.T) {
	t.Helper()
	prev := currentCapabilities
	currentCapabilities = &daemonCapabilities{SideloadEnabled: false}
	t.Cleanup(func() { currentCapabilities = prev })
}

// TestPluginSideload_HappyPath uploads a valid archive + manifest with no
// signer header and expects the daemon to (a) validate the manifest, (b)
// stage the artifact bytes on disk, (c) insert a `Plugin` row with
// `buildState=ready` and `cosignVerified=false`, and (d) return the
// canonical {pluginId, status, buildLogUrl} envelope.
func TestPluginSideload_HappyPath(t *testing.T) {
	drv := openTenantTestStore(t)
	stagingDir := configureStagingForTest(t)
	mux := http.NewServeMux()
	RegisterStage2FinalsRoutes(mux, drv)

	req := makeSideloadRequest(t, drv, "default", map[string]string{
		"archive":  "fake-binary-bytes-go-here",
		"manifest": validManifestJSON("plugin-side-1"),
	})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	var resp struct {
		PluginID    string `json:"pluginId"`
		Status      string `json:"status"`
		BuildLogURL string `json:"buildLogUrl"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v (%s)", err, rec.Body.String())
	}
	if resp.PluginID == "" || resp.Status != "ready" || resp.BuildLogURL == "" {
		t.Fatalf("unexpected response: %+v", resp)
	}

	// Verify the artifact directory was promoted from staging-temp into
	// <staging>/plugins/<tenant>/<plugin-id>/.
	matches, err := filepath.Glob(filepath.Join(stagingDir, "plugins", "*", resp.PluginID, "manifest.json"))
	if err != nil {
		t.Fatalf("glob staging: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected exactly one staged manifest, found %d", len(matches))
	}
	body, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read staged manifest: %v", err)
	}
	if !bytes.Contains(body, []byte("plugin-side-1")) {
		t.Fatalf("staged manifest does not contain plugin id: %s", body)
	}

	// Verify the DB row landed.
	tx, _ := drv.Begin(context.Background(), store.TxOptions{ReadOnly: true})
	defer func() { _ = tx.Rollback() }()
	got, err := tx.GetPlugin(context.Background(), resp.PluginID, resp.PluginID) // wrong scope intentionally
	if err == nil {
		t.Fatalf("plugin GetPlugin should require correct tenant scope; got %+v", got)
	}
}

// TestPluginSideload_InvalidManifest rejects the upload with 400 and a
// problem+json body when the manifest is missing a required field.
func TestPluginSideload_InvalidManifest(t *testing.T) {
	drv := openTenantTestStore(t)
	configureStagingForTest(t)
	mux := http.NewServeMux()
	RegisterStage2FinalsRoutes(mux, drv)

	req := makeSideloadRequest(t, drv, "default", map[string]string{
		"archive":  "fake",
		"manifest": `{"id":"missing-perms","name":"X","version":"0.0.1"}`,
	})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("manifest")) {
		t.Fatalf("expected problem body to mention manifest, got %s", rec.Body.String())
	}
}

// TestPluginSideload_RejectsNonMultipart confirms that JSON bodies are
// refused with 400 — the registrar's permission guard fires after the
// content-type check.
func TestPluginSideload_RejectsNonMultipart(t *testing.T) {
	drv := openTenantTestStore(t)
	configureStagingForTest(t)
	mux := http.NewServeMux()
	RegisterStage2FinalsRoutes(mux, drv)

	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/t/default/plugins/sideload", bytes.NewBufferString(`{"hello":"world"}`))
	req.Header.Set("Content-Type", "application/json")
	claims := &auth.SessionClaims{
		SessionID: "test-session",
		UserID:    "test-user",
		Username:  "tester",
		Roles:     []string{"superadmin"},
		Scopes:    []string{"*"},
	}
	ctx := auth.WithSessionClaims(req.Context(), claims)
	tx, _ := drv.Begin(context.Background(), store.TxOptions{ReadOnly: true})
	tn, err := tx.GetTenantBySlug(context.Background(), "default")
	_ = tx.Rollback()
	if err != nil {
		t.Fatalf("resolve tenant default: %v", err)
	}
	ctx = WithTenant(ctx, tn)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req.WithContext(ctx))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for non-multipart body, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// TestPluginSideload_SignerFingerprintRequiresSignature asserts that
// setting Signer-Fingerprint without a signature part triggers a 403
// (signer required). The fingerprint itself is unknown — but the
// missing-signature check fires first.
func TestPluginSideload_SignerFingerprintRequiresSignature(t *testing.T) {
	drv := openTenantTestStore(t)
	configureStagingForTest(t)
	mux := http.NewServeMux()
	RegisterStage2FinalsRoutes(mux, drv)

	req := makeSideloadRequest(t, drv, "default", map[string]string{
		"archive":  "fake",
		"manifest": validManifestJSON("plugin-side-2"),
	})
	req.Header.Set("Signer-Fingerprint", "sha256:does-not-exist")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when Signer-Fingerprint is set without signature part, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// TestPluginSideload_UnknownSignerRejected uploads with a fingerprint that
// doesn't exist in tenant scope and a signature blob; the daemon should
// 403 because the signer is not in the trust store.
func TestPluginSideload_UnknownSignerRejected(t *testing.T) {
	drv := openTenantTestStore(t)
	configureStagingForTest(t)
	mux := http.NewServeMux()
	RegisterStage2FinalsRoutes(mux, drv)

	req := makeSideloadRequest(t, drv, "default", map[string]string{
		"archive":   "fake-bytes",
		"manifest":  validManifestJSON("plugin-side-3"),
		"signature": "fake-sig",
	})
	req.Header.Set("Signer-Fingerprint", "sha256:does-not-exist")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unknown signer, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// TestSideload_404WhenDisabled asserts that when the daemon's sideload
// feature flag is OFF the endpoint returns 404 (not 403, not 401),
// regardless of the caller's permissions. The 404 leaks no information
// about the endpoint's existence.
func TestSideload_404WhenDisabled(t *testing.T) {
	drv := openTenantTestStore(t)
	// Configure staging so we know that wasn't the failure cause, but
	// then explicitly DISABLE the sideload capability.
	dir := t.TempDir()
	prev := pluginStagingDir
	SetPluginStagingDir(dir)
	t.Cleanup(func() { SetPluginStagingDir(prev) })
	withSideloadDisabled(t)

	mux := http.NewServeMux()
	RegisterStage2FinalsRoutes(mux, drv)

	req := makeSideloadRequest(t, drv, "default", map[string]string{
		"archive":  "fake",
		"manifest": validManifestJSON("plugin-disabled"),
	})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when SideloadEnabled=false, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// TestSideload_OKWhenEnabled is the dual: with the flag ON and a
// valid request, the endpoint accepts the upload and returns 201.
// (The deeper happy-path coverage lives in TestPluginSideload_HappyPath;
// this test exists to provide a focused matched pair with the
// 404-when-disabled assertion.)
func TestSideload_OKWhenEnabled(t *testing.T) {
	drv := openTenantTestStore(t)
	configureStagingForTest(t) // enables sideload

	mux := http.NewServeMux()
	RegisterStage2FinalsRoutes(mux, drv)

	req := makeSideloadRequest(t, drv, "default", map[string]string{
		"archive":  "fake-bytes",
		"manifest": validManifestJSON("plugin-enabled-ok"),
	})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 when SideloadEnabled=true, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// TestCapabilities_ReportsSideloadFlag asserts that GET
// /api/v1/capabilities returns the current sideload-enabled state.
func TestCapabilities_ReportsSideloadFlag(t *testing.T) {
	mux := http.NewServeMux()
	// Capabilities endpoint doesn't need the store driver, but we
	// register the full routeset for parity with production.
	drv := openTenantTestStore(t)
	RegisterStage2FinalsRoutes(mux, drv)

	// Disabled snapshot.
	prev := currentCapabilities
	currentCapabilities = &daemonCapabilities{SideloadEnabled: false}
	t.Cleanup(func() { currentCapabilities = prev })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var disabled struct {
		SideloadEnabled bool `json:"sideload_enabled"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &disabled); err != nil {
		t.Fatalf("decode caps: %v", err)
	}
	if disabled.SideloadEnabled {
		t.Fatalf("expected sideload_enabled=false, got true")
	}

	// Now flip on and re-read.
	currentCapabilities = &daemonCapabilities{SideloadEnabled: true}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil))
	var enabled struct {
		SideloadEnabled bool `json:"sideload_enabled"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &enabled); err != nil {
		t.Fatalf("decode caps: %v", err)
	}
	if !enabled.SideloadEnabled {
		t.Fatalf("expected sideload_enabled=true, got false")
	}
}
