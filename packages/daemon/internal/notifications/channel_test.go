package notifications_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/notifications"
	"github.com/riokulabs/rioku/internal/store"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestEmailChannel_Send(t *testing.T) {
	cfgJSON := `{"to":["alice@example.test"],"from":"rioku@example.test","host":"localhost","port":2525}`
	ch, err := notifications.NewEmailChannel(cfgJSON, "", 0)
	if err != nil {
		t.Fatalf("NewEmailChannel: %v", err)
	}

	var (
		gotAddr string
		gotFrom string
		gotTo   []string
		gotMsg  []byte
	)
	ch.Sender = func(addr string, _ smtp.Auth, from string, to []string, msg []byte) error {
		gotAddr, gotFrom, gotTo, gotMsg = addr, from, to, msg
		return nil
	}

	if err := ch.Send(context.Background(), notifications.Message{
		Kind:    "test",
		Subject: "Hello",
		Body:    "world",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if gotAddr != "localhost:2525" {
		t.Errorf("addr = %q", gotAddr)
	}
	if gotFrom != "rioku@example.test" {
		t.Errorf("from = %q", gotFrom)
	}
	if len(gotTo) != 1 || gotTo[0] != "alice@example.test" {
		t.Errorf("to = %v", gotTo)
	}
	if !strings.Contains(string(gotMsg), "Subject: Hello") {
		t.Errorf("msg missing Subject header: %s", gotMsg)
	}
	if !strings.Contains(string(gotMsg), "X-Rioku-Kind: test") {
		t.Errorf("msg missing X-Rioku-Kind: %s", gotMsg)
	}
}

func TestEmailChannel_BadConfig(t *testing.T) {
	if _, err := notifications.NewEmailChannel(`{"from":"x@y"}`, "", 0); err == nil || !notifications.IsPermanent(err) {
		t.Errorf("expected permanent error for missing to: %v", err)
	}
	if _, err := notifications.NewEmailChannel(`not-json`, "", 0); err == nil || !notifications.IsPermanent(err) {
		t.Errorf("expected permanent error for bad json: %v", err)
	}
}

func TestWebhookChannel_Send(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("content-type = %s", r.Header.Get("Content-Type"))
		}
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch, err := notifications.NewWebhookChannel(`{"url":"`+srv.URL+`"}`, nil)
	if err != nil {
		t.Fatalf("NewWebhookChannel: %v", err)
	}
	if err := ch.Send(context.Background(), notifications.Message{
		Kind: "test", Subject: "S", Body: "B",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !strings.Contains(string(gotBody), `"subject":"S"`) {
		t.Errorf("body missing subject: %s", gotBody)
	}
	if !strings.Contains(string(gotBody), `"kind":"test"`) {
		t.Errorf("body missing kind: %s", gotBody)
	}
}

func TestWebhookChannel_4xx_IsPermanent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	ch, _ := notifications.NewWebhookChannel(`{"url":"`+srv.URL+`"}`, nil)
	err := ch.Send(context.Background(), notifications.Message{Kind: "test", Subject: "x"})
	if err == nil || !notifications.IsPermanent(err) {
		t.Errorf("expected permanent error, got %v", err)
	}
}

func TestWebhookChannel_5xx_IsTransient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	ch, _ := notifications.NewWebhookChannel(`{"url":"`+srv.URL+`"}`, nil)
	err := ch.Send(context.Background(), notifications.Message{Kind: "test", Subject: "x"})
	if err == nil || notifications.IsPermanent(err) {
		t.Errorf("expected transient error, got %v", err)
	}
}

// TestDispatcher_RetryThenSuccess verifies the dispatcher retries
// transient errors and writes a delivery_log entry per attempt.
func TestDispatcher_RetryThenSuccess(t *testing.T) {
	drv := openDB(t)
	tenantID := "tenant_default"

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := calls.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ctx := store.WithTenantID(context.Background(), tenantID)
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	ch, err := tx.CreateNotificationChannel(ctx, &store.NotificationChannel{
		TenantID: tenantID,
		Name:     "wh-retry",
		Kind:     "webhook",
		Config:   `{"url":"` + srv.URL + `"}`,
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	disp.MaxRetries = 3
	disp.BaseBackoff = time.Millisecond
	disp.PerAttemptTimeout = time.Second

	if err := disp.SendToChannel(ctx, ch, notifications.Message{Kind: "test", Subject: "s"}, nil); err != nil {
		t.Fatalf("SendToChannel: %v", err)
	}
	if got := calls.Load(); got != 3 {
		t.Errorf("calls = %d, want 3", got)
	}

	tx2, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	entries, err := tx2.ListDeliveryLogByTenant(ctx, tenantID, store.DeliveryLogQuery{Limit: 10})
	_ = tx2.Rollback()
	if err != nil {
		t.Fatalf("ListDeliveryLogByTenant: %v", err)
	}
	if len(entries) != 3 {
		t.Errorf("expected 3 delivery log entries (2 retrying + 1 delivered), got %d", len(entries))
	}
}

func TestDispatcher_PermanentErrorStopsRetry(t *testing.T) {
	drv := openDB(t)
	tenantID := "tenant_default"

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest) // permanent
	}))
	defer srv.Close()

	ctx := store.WithTenantID(context.Background(), tenantID)
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	ch, err := tx.CreateNotificationChannel(ctx, &store.NotificationChannel{
		TenantID: tenantID, Name: "wh-perm", Kind: "webhook",
		Config: `{"url":"` + srv.URL + `"}`, Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}
	_ = tx.Commit()

	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	disp.MaxRetries = 5
	disp.BaseBackoff = time.Millisecond

	err = disp.SendToChannel(ctx, ch, notifications.Message{Kind: "test", Subject: "s"}, nil)
	if err == nil || !notifications.IsPermanent(err) {
		t.Errorf("expected permanent error, got %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Errorf("calls = %d, want 1 (no retry on permanent)", got)
	}
}

func TestDispatcher_UnknownKind(t *testing.T) {
	drv := openDB(t)
	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	err := disp.SendToChannel(context.Background(), &store.NotificationChannel{
		ID: "ch_x", TenantID: "tenant_default", Name: "weird", Kind: "telepathy", Config: "{}", Enabled: true,
	}, notifications.Message{Kind: "test"}, nil)
	if err == nil || !notifications.IsPermanent(err) {
		t.Errorf("expected permanent error for unknown kind, got %v", err)
	}
}

// Verify the IsPermanent helper composes with errors.Is across wrapping.
func TestErrorPermanent_Wrapping(t *testing.T) {
	base := errors.New("oops")
	wrapped := notifications.ErrorPermanent(base)
	if !notifications.IsPermanent(wrapped) {
		t.Errorf("ErrorPermanent should be permanent")
	}
	if !errors.Is(wrapped, notifications.ErrPermanent) {
		t.Errorf("errors.Is should match ErrPermanent")
	}
}
