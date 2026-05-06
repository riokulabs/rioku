package gateway

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
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

func TestPluginSideload_StubReturns501(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterStage2FinalsRoutes(mux, drv)

	req := makeSideloadRequest(t, drv, "default", map[string]string{
		"archive":  "fake-binary-bytes",
		"manifest": `{"id":"x","version":"0.0.1","kind":"http"}`,
	})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Errorf("expected 501, got %d (%s)", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") == "" {
		t.Errorf("expected a content-type header on the problem response")
	}
}

func TestPluginSideload_RejectsNonMultipart(t *testing.T) {
	drv := openTenantTestStore(t)
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
