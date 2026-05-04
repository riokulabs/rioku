// Package notifications implements the webhook fan-out for
// state-transition events emitted by the API-management service
// (#164, Sprint 4 Phase 1e).
//
// Dispatcher subscribes to grpc.WebhookEvent calls, looks up the
// tenant's webhook_endpoints whose Events list includes the event
// type, and POSTs an HMAC-signed JSON body to each. Failures are
// retried with exponential backoff up to MaxRetries; persistent
// failures are logged but do not block the originating request.
//
// The dispatcher is best-effort: a transient remote failure must
// not roll back the originating state change. Operators get
// retries + structured logs; if they need at-least-once delivery
// guarantees they should subscribe to the audit log directly
// instead.
package notifications

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// EventConsumer is the narrow surface the gRPC api-management
// service calls. The grpc.WebhookEmitter interface is satisfied by
// any type with this Emit method (no import cycle — the gRPC
// package's interface is structural).
type EventConsumer interface {
	Emit(ctx context.Context, event Event)
}

// Event is the event shape we dispatch. Mirrors grpc.WebhookEvent
// but lives here so the package is self-contained for tests.
type Event struct {
	Type     string
	TenantID string
	Actor    string
	Payload  map[string]any
}

// Dispatcher holds the per-tenant webhook delivery loop.
type Dispatcher struct {
	store      store.Driver
	httpClient *http.Client
	log        *slog.Logger

	// MaxRetries caps the exponential-backoff retry sequence per
	// (event, endpoint) attempt. Default 3.
	MaxRetries int

	// RequestTimeout caps each HTTP POST. Default 10s.
	RequestTimeout time.Duration

	// queue is a small in-process queue. The dispatcher drains
	// it on a worker goroutine to keep the originating request
	// path non-blocking.
	queue   chan Event
	started bool
	mu      sync.Mutex
	wg      sync.WaitGroup
	cancel  context.CancelFunc
}

// New constructs a Dispatcher. Call Start to begin draining;
// Emit before Start enqueues but does nothing until Start runs.
func New(st store.Driver, log *slog.Logger) *Dispatcher {
	return &Dispatcher{
		store: st,
		log:   log,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		MaxRetries:     3,
		RequestTimeout: 10 * time.Second,
		queue:          make(chan Event, 256),
	}
}

// Start launches the worker goroutine. Idempotent.
func (d *Dispatcher) Start(ctx context.Context) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.started {
		return
	}
	d.started = true
	wctx, cancel := context.WithCancel(ctx)
	d.cancel = cancel
	d.wg.Add(1)
	go d.run(wctx)
}

// Stop drains in-flight events and stops the worker. Safe to call
// multiple times.
func (d *Dispatcher) Stop() {
	d.mu.Lock()
	if !d.started {
		d.mu.Unlock()
		return
	}
	if d.cancel != nil {
		d.cancel()
	}
	d.started = false
	d.mu.Unlock()
	d.wg.Wait()
}

// Emit enqueues an event. Drops the event with a structured log
// line if the queue is full — the originating request must never
// block on webhook fan-out.
func (d *Dispatcher) Emit(_ context.Context, ev Event) {
	select {
	case d.queue <- ev:
	default:
		d.log.Warn("notifications: queue full, dropping event",
			"event_type", ev.Type, "tenant_id", ev.TenantID)
	}
}

func (d *Dispatcher) run(ctx context.Context) {
	defer d.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-d.queue:
			d.dispatch(ctx, ev)
		}
	}
}

// dispatch fans out a single event to every matching endpoint
// in the tenant.
func (d *Dispatcher) dispatch(ctx context.Context, ev Event) {
	tx, err := d.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		d.log.Error("notifications: begin tx", "error", err)
		return
	}
	endpoints, err := tx.ListWebhookEndpointsByTenant(ctx, ev.TenantID)
	_ = tx.Rollback()
	if err != nil {
		d.log.Error("notifications: list webhooks", "tenant_id", ev.TenantID, "error", err)
		return
	}

	body, err := buildBody(ev)
	if err != nil {
		d.log.Error("notifications: marshal body", "event_type", ev.Type, "error", err)
		return
	}

	for _, ep := range endpoints {
		if !ep.Enabled {
			continue
		}
		if !endpointMatches(ep, ev.Type) {
			continue
		}
		go d.post(ctx, ep, ev.Type, body)
	}
}

// endpointMatches checks the endpoint's Events JSON array against
// ev.Type. The array convention is one of:
//
//	["*"]                            — all events
//	["plan.*"]                       — wildcard prefix match
//	["plan.created", "plan.published"] — exact list
func endpointMatches(ep *store.WebhookEndpoint, eventType string) bool {
	var list []string
	if err := json.Unmarshal([]byte(ep.Events), &list); err != nil {
		return false
	}
	for _, p := range list {
		if p == "*" {
			return true
		}
		if strings.HasSuffix(p, ".*") && strings.HasPrefix(eventType, strings.TrimSuffix(p, "*")) {
			return true
		}
		if p == eventType {
			return true
		}
	}
	return false
}

// post sends one HTTP POST with retry. Each retry doubles the
// backoff up to a cap.
func (d *Dispatcher) post(ctx context.Context, ep *store.WebhookEndpoint, eventType string, body []byte) {
	delay := 250 * time.Millisecond
	for attempt := 0; attempt <= d.MaxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, ep.URL, bytes.NewReader(body))
		if err != nil {
			d.log.Error("notifications: build request",
				"endpoint_id", ep.ID, "error", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Rioku-Event", eventType)
		req.Header.Set("X-Rioku-Delivery-Attempt", fmt.Sprintf("%d", attempt+1))
		if ep.Secret != nil && *ep.Secret != "" {
			req.Header.Set("X-Rioku-Signature", signBody(body, *ep.Secret))
		}

		resp, err := d.httpClient.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode/100 == 2 {
				return
			}
			err = fmt.Errorf("status %d", resp.StatusCode)
		}

		if attempt == d.MaxRetries {
			d.log.Warn("notifications: webhook delivery failed",
				"endpoint_id", ep.ID,
				"event_type", eventType,
				"attempts", attempt+1,
				"error", err)
			return
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay *= 2
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}
	}
}

// buildBody renders the canonical JSON envelope for the event.
// Operators' webhook receivers expect this exact shape; changes
// are versioned via the "v" field and a future "v": "v2" can ship
// alongside v1.
func buildBody(ev Event) ([]byte, error) {
	envelope := map[string]any{
		"v":          "v1",
		"event_type": ev.Type,
		"tenant_id":  ev.TenantID,
		"actor":      ev.Actor,
		"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
		"payload":    ev.Payload,
	}
	return json.Marshal(envelope)
}

// signBody returns the HMAC-SHA256 signature over body, hex-
// encoded with a "sha256=" prefix. Webhook receivers verify by
// recomputing the HMAC with their stored secret and comparing.
func signBody(body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}
