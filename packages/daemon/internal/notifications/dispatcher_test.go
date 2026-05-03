package notifications_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/notifications"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func openDB(t *testing.T) store.Driver {
	t.Helper()
	d, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(context.Background(), store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := d.Migrate(context.Background(), store.MigrateUp); err != nil {
		t.Fatal(err)
	}
	return d
}

func registerEndpoint(t *testing.T, d store.Driver, url, events string, secret string) string {
	t.Helper()
	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, _ := d.Begin(ctx, store.TxOptions{})
	id := "wh_" + uuid.NewString()
	var sec *string
	if secret != "" {
		sec = &secret
	}
	if _, err := tx.CreateWebhookEndpoint(ctx, &store.WebhookEndpoint{
		ID:       id,
		TenantID: "tenant_default",
		Name:     "test-" + id,
		URL:      url,
		Secret:   sec,
		Events:   events,
		Enabled:  true,
	}); err != nil {
		t.Fatalf("CreateWebhookEndpoint: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return id
}

// receiver is a tiny httptest receiver that records every body
// + header set it sees. Tests dispatch and then assert on calls.
type receiver struct {
	mu      sync.Mutex
	calls   []recorded
	failNTimes atomic.Int32
}

type recorded struct {
	body      []byte
	signature string
	eventType string
	attempt   string
}

func (r *receiver) handler(w http.ResponseWriter, req *http.Request) {
	body, _ := io.ReadAll(req.Body)
	r.mu.Lock()
	r.calls = append(r.calls, recorded{
		body:      body,
		signature: req.Header.Get("X-Rioku-Signature"),
		eventType: req.Header.Get("X-Rioku-Event"),
		attempt:   req.Header.Get("X-Rioku-Delivery-Attempt"),
	})
	r.mu.Unlock()
	if r.failNTimes.Load() > 0 {
		r.failNTimes.Add(-1)
		http.Error(w, "transient", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (r *receiver) records() []recorded {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]recorded, len(r.calls))
	copy(out, r.calls)
	return out
}

// waitForCalls polls until the receiver has seen min calls or
// the deadline expires.
func waitForCalls(t *testing.T, r *receiver, min int, deadline time.Duration) {
	t.Helper()
	end := time.Now().Add(deadline)
	for time.Now().Before(end) {
		if len(r.records()) >= min {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("only got %d calls within %v, wanted >= %d", len(r.records()), deadline, min)
}

func TestDispatcher_FanoutToMatchingEndpoint(t *testing.T) {
	d := openDB(t)
	r := &receiver{}
	srv := httptest.NewServer(http.HandlerFunc(r.handler))
	defer srv.Close()

	registerEndpoint(t, d, srv.URL, `["plan.created", "plan.published"]`, "")

	disp := notifications.New(d, slog.Default())
	disp.MaxRetries = 0
	disp.Start(context.Background())
	defer disp.Stop()

	disp.Emit(context.Background(), notifications.Event{
		Type:     "plan.created",
		TenantID: "tenant_default",
		Actor:    "test-actor",
		Payload:  map[string]any{"id": "plan-1"},
	})

	waitForCalls(t, r, 1, 2*time.Second)

	calls := r.records()
	if calls[0].eventType != "plan.created" {
		t.Errorf("X-Rioku-Event = %q", calls[0].eventType)
	}
	var envelope map[string]any
	if err := json.Unmarshal(calls[0].body, &envelope); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if envelope["v"] != "v1" {
		t.Errorf("envelope.v = %v", envelope["v"])
	}
	if envelope["actor"] != "test-actor" {
		t.Errorf("envelope.actor = %v", envelope["actor"])
	}
}

func TestDispatcher_NonMatchingEventTypeNotDelivered(t *testing.T) {
	d := openDB(t)
	r := &receiver{}
	srv := httptest.NewServer(http.HandlerFunc(r.handler))
	defer srv.Close()

	// Endpoint subscribes to subscription.* only.
	registerEndpoint(t, d, srv.URL, `["subscription.*"]`, "")

	disp := notifications.New(d, slog.Default())
	disp.MaxRetries = 0
	disp.Start(context.Background())
	defer disp.Stop()

	// Fire a plan event — should NOT be delivered.
	disp.Emit(context.Background(), notifications.Event{
		Type:     "plan.created",
		TenantID: "tenant_default",
		Payload:  map[string]any{"id": "plan-1"},
	})
	time.Sleep(300 * time.Millisecond)

	if got := len(r.records()); got != 0 {
		t.Fatalf("got %d deliveries, want 0 for non-matching event", got)
	}
}

func TestDispatcher_WildcardMatchAll(t *testing.T) {
	d := openDB(t)
	r := &receiver{}
	srv := httptest.NewServer(http.HandlerFunc(r.handler))
	defer srv.Close()

	registerEndpoint(t, d, srv.URL, `["*"]`, "")

	disp := notifications.New(d, slog.Default())
	disp.MaxRetries = 0
	disp.Start(context.Background())
	defer disp.Stop()

	for _, eventType := range []string{"plan.created", "subscription.accepted", "application.closed"} {
		disp.Emit(context.Background(), notifications.Event{
			Type:     eventType,
			TenantID: "tenant_default",
			Payload:  map[string]any{},
		})
	}
	waitForCalls(t, r, 3, 2*time.Second)
}

func TestDispatcher_HMACSignatureWhenSecretSet(t *testing.T) {
	d := openDB(t)
	r := &receiver{}
	srv := httptest.NewServer(http.HandlerFunc(r.handler))
	defer srv.Close()

	const secret = "shhhh"
	registerEndpoint(t, d, srv.URL, `["plan.*"]`, secret)

	disp := notifications.New(d, slog.Default())
	disp.MaxRetries = 0
	disp.Start(context.Background())
	defer disp.Stop()

	disp.Emit(context.Background(), notifications.Event{
		Type: "plan.published", TenantID: "tenant_default",
		Payload: map[string]any{"x": 1},
	})
	waitForCalls(t, r, 1, 2*time.Second)

	c := r.records()[0]
	expected := computeSig(c.body, secret)
	if c.signature != expected {
		t.Fatalf("signature = %q, want %q", c.signature, expected)
	}
}

func TestDispatcher_RetriesOnTransientFailure(t *testing.T) {
	d := openDB(t)
	r := &receiver{}
	r.failNTimes.Store(2) // fail twice, succeed on the 3rd attempt
	srv := httptest.NewServer(http.HandlerFunc(r.handler))
	defer srv.Close()

	registerEndpoint(t, d, srv.URL, `["plan.*"]`, "")

	disp := notifications.New(d, slog.Default())
	disp.MaxRetries = 5
	disp.Start(context.Background())
	defer disp.Stop()

	disp.Emit(context.Background(), notifications.Event{
		Type: "plan.created", TenantID: "tenant_default",
		Payload: map[string]any{},
	})
	waitForCalls(t, r, 3, 5*time.Second)

	calls := r.records()
	if calls[0].attempt != "1" || calls[1].attempt != "2" || calls[2].attempt != "3" {
		t.Errorf("attempt counters = %q,%q,%q", calls[0].attempt, calls[1].attempt, calls[2].attempt)
	}
}

func TestDispatcher_DisabledEndpointSkipped(t *testing.T) {
	d := openDB(t)
	r := &receiver{}
	srv := httptest.NewServer(http.HandlerFunc(r.handler))
	defer srv.Close()

	id := registerEndpoint(t, d, srv.URL, `["*"]`, "")
	// Disable it.
	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, _ := d.Begin(ctx, store.TxOptions{})
	enabled := false
	if _, err := tx.UpdateWebhookEndpoint(ctx, "tenant_default", id, store.UpdateWebhookEndpointParams{Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()

	disp := notifications.New(d, slog.Default())
	disp.Start(context.Background())
	defer disp.Stop()

	disp.Emit(context.Background(), notifications.Event{
		Type: "plan.created", TenantID: "tenant_default",
		Payload: map[string]any{},
	})
	time.Sleep(300 * time.Millisecond)

	if got := len(r.records()); got != 0 {
		t.Fatalf("disabled endpoint received %d calls", got)
	}
}

func TestDispatcher_FanoutToMultipleEndpoints(t *testing.T) {
	d := openDB(t)
	r1 := &receiver{}
	r2 := &receiver{}
	srv1 := httptest.NewServer(http.HandlerFunc(r1.handler))
	defer srv1.Close()
	srv2 := httptest.NewServer(http.HandlerFunc(r2.handler))
	defer srv2.Close()

	registerEndpoint(t, d, srv1.URL, `["*"]`, "")
	registerEndpoint(t, d, srv2.URL, `["plan.created"]`, "")

	disp := notifications.New(d, slog.Default())
	disp.MaxRetries = 0
	disp.Start(context.Background())
	defer disp.Stop()

	disp.Emit(context.Background(), notifications.Event{
		Type: "plan.created", TenantID: "tenant_default",
		Payload: map[string]any{},
	})
	waitForCalls(t, r1, 1, 2*time.Second)
	waitForCalls(t, r2, 1, 2*time.Second)
}

func TestDispatcher_QueueOverflowDropsEvents(t *testing.T) {
	d := openDB(t)

	// No registered endpoints — events that DO get processed
	// produce no IO. We just want to validate the drop path
	// when the queue is full.
	disp := notifications.New(d, slog.Default())
	// Don't Start — that way the queue fills up without being
	// drained, exercising the default branch in Emit.

	for i := 0; i < 1000; i++ {
		disp.Emit(context.Background(), notifications.Event{
			Type: "plan.created", TenantID: "tenant_default",
		})
	}
	// If Emit had blocked, this loop would never reach here.
}

func computeSig(body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// Compile-time guard the dispatcher exposes the expected
// EventConsumer surface.
var _ = func() {
	var _ interface {
		Emit(ctx context.Context, ev notifications.Event)
	} = (*notifications.Dispatcher)(nil)
	_ = strings.Repeat
}
