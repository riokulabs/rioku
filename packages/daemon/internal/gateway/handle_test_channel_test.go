package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/notifications"
	"github.com/riokulabs/rioku/internal/store"
)

// installStubChannelDispatcher swaps the package-level channel dispatcher
// for one whose SMTP sender is a no-op (or one that errors with sendErr).
// Returns a cleanup func that restores the previous dispatcher.
func installStubChannelDispatcher(t *testing.T, drv store.Driver, sendErr error) func() {
	t.Helper()
	disp := notifications.NewChannelDispatcher(drv, slog.New(slog.NewTextHandler(io.Discard, nil)))
	disp.HTTPClient = &http.Client{Transport: stubRoundTripper{err: sendErr}}
	disp.MaxRetries = 1
	disp.BaseBackoff = 0
	disp.DefaultSMTPHost = "localhost"
	disp.DefaultSMTPPort = 1
	notifications.DefaultSMTPSender = func(addr string, auth smtp.Auth, from string, to []string, msg []byte) error {
		return sendErr
	}
	SetChannelDispatcherForTest(disp)
	return func() {
		SetChannelDispatcherForTest(nil)
		notifications.DefaultSMTPSender = smtp.SendMail
	}
}

// stubRoundTripper returns either err on every call, or a 200 OK if err is nil.
type stubRoundTripper struct {
	err error
}

func (s stubRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &http.Response{
		StatusCode: 200,
		Body:       io.NopCloser(strings.NewReader("ok")),
		Header:     make(http.Header),
		Request:    req,
	}, nil
}

func TestHandleTestChannel_HappyPath(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)
	cleanup := installStubChannelDispatcher(t, drv, nil)
	defer cleanup()

	// Create a webhook channel.
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notification-channels", "default",
		map[string]any{"name": "wh-1", "kind": "webhook", "config": map[string]any{"url": "http://example.com/x"}}))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", r.Code, r.Body.String())
	}
	var ch channelResponse
	_ = json.NewDecoder(r.Body).Decode(&ch)

	// Test send.
	tr := httptest.NewRecorder()
	mux.ServeHTTP(tr, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notification-channels/"+ch.ID+"/test", "default", nil))
	if tr.Code != http.StatusOK {
		t.Fatalf("test: %d (%s)", tr.Code, tr.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(tr.Body).Decode(&resp)
	if resp["ok"] != true {
		t.Errorf("ok = %v, want true", resp["ok"])
	}
	if resp["deliveredAt"] == nil || resp["deliveredAt"] == "" {
		t.Errorf("missing deliveredAt: %v", resp)
	}

	// Verify a delivery-log entry was written.
	tx, _ := drv.Begin(context.Background(), store.TxOptions{ReadOnly: true})
	entries, err := tx.ListDeliveryLogByTenant(context.Background(), "tenant_default", store.DeliveryLogQuery{Limit: 10})
	_ = tx.Rollback()
	if err != nil {
		t.Fatalf("list delivery log: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("expected at least one delivery log entry")
	}
	if entries[0].Status != "delivered" {
		t.Errorf("status = %q, want delivered", entries[0].Status)
	}
}

func TestHandleTestChannel_NotFound(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)
	cleanup := installStubChannelDispatcher(t, drv, nil)
	defer cleanup()

	tr := httptest.NewRecorder()
	mux.ServeHTTP(tr, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notification-channels/does-not-exist/test", "default", nil))
	if tr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d (%s)", tr.Code, tr.Body.String())
	}
}

func TestHandleTestChannel_SendFails(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterNotificationsRoutes(mux, drv)
	cleanup := installStubChannelDispatcher(t, drv, errors.New("boom"))
	defer cleanup()

	// Create a webhook channel.
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notification-channels", "default",
		map[string]any{"name": "wh-fail", "kind": "webhook", "config": map[string]any{"url": "http://example.com/x"}}))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d", r.Code)
	}
	var ch channelResponse
	_ = json.NewDecoder(r.Body).Decode(&ch)

	tr := httptest.NewRecorder()
	mux.ServeHTTP(tr, authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/notification-channels/"+ch.ID+"/test", "default", nil))
	if tr.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %d (%s)", tr.Code, tr.Body.String())
	}

	// Verify a delivery-log entry with status=failed was written.
	tx, _ := drv.Begin(context.Background(), store.TxOptions{ReadOnly: true})
	entries, err := tx.ListDeliveryLogByTenant(context.Background(), "tenant_default", store.DeliveryLogQuery{Limit: 10})
	_ = tx.Rollback()
	if err != nil {
		t.Fatalf("list delivery log: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("expected delivery log entry")
	}
	if entries[0].Status != "failed" {
		t.Errorf("status = %q, want failed", entries[0].Status)
	}
}
