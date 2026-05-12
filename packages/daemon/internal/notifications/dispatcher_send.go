package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
)

// ChannelDispatcher is the channel send-side path: given a stored
// NotificationChannel and a Message, build the appropriate Channel
// implementation and dispatch with retry, writing a delivery-log
// entry per attempt.
//
// This sits alongside the api-management webhook fan-out Dispatcher
// (dispatcher.go) but is a different code path with different
// semantics (per-tenant channels, retries, persistent delivery log).
type ChannelDispatcher struct {
	Store store.Driver
	Log   *slog.Logger

	// HTTPClient is shared between webhook + slack channels.
	HTTPClient *http.Client

	// MaxRetries caps retries on transient failure. Default 3
	// (i.e. up to 3 attempts total — 1 initial + 2 retries).
	MaxRetries int

	// BaseBackoff is the initial sleep between retries. Doubles
	// each attempt. Default 250ms.
	BaseBackoff time.Duration

	// MaxBackoff caps the per-retry sleep. Default 30s.
	MaxBackoff time.Duration

	// PerAttemptTimeout caps each individual Send. Default 10s.
	PerAttemptTimeout time.Duration

	// DefaultSMTPHost / DefaultSMTPPort are passed to email channels
	// when their config omits Host. Sandbox wires these to mailpit
	// (localhost:1025).
	DefaultSMTPHost string
	DefaultSMTPPort int

	// nowFn allows tests to control time.Now without monkey-patching.
	// nil -> time.Now.
	nowFn func() time.Time
}

// NewChannelDispatcher constructs a ChannelDispatcher with sensible
// defaults. log MUST be non-nil; pass slog.New(slog.NewJSONHandler(...))
// from the caller.
func NewChannelDispatcher(st store.Driver, log *slog.Logger) *ChannelDispatcher {
	return &ChannelDispatcher{
		Store:             st,
		Log:               log,
		HTTPClient:        &http.Client{Timeout: 10 * time.Second},
		MaxRetries:        3,
		BaseBackoff:       250 * time.Millisecond,
		MaxBackoff:        30 * time.Second,
		PerAttemptTimeout: 10 * time.Second,
	}
}

func (d *ChannelDispatcher) now() time.Time {
	if d.nowFn != nil {
		return d.nowFn()
	}
	return time.Now()
}

// SendNotification dispatches msg to all enabled channels for the
// tenant. Each channel attempt is retried independently per
// MaxRetries. Returns the count of channels that ultimately
// delivered and the count that failed; per-channel detail lands
// in the delivery_log table.
//
// Errors returned cover infrastructure failures only (DB unreachable);
// per-channel send failures are logged + recorded but do not bubble
// up — best-effort fan-out semantics.
func (d *ChannelDispatcher) SendNotification(ctx context.Context, tenantID string, msg Message) (delivered, failed int, err error) {
	tx, err := d.Store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return 0, 0, fmt.Errorf("begin tx: %w", err)
	}
	channels, err := tx.ListNotificationChannelsByTenant(ctx, tenantID)
	_ = tx.Rollback()
	if err != nil {
		return 0, 0, fmt.Errorf("list channels: %w", err)
	}

	for _, ch := range channels {
		if !ch.Enabled {
			continue
		}
		if dispErr := d.SendToChannel(ctx, ch, msg, nil); dispErr != nil {
			failed++
			continue
		}
		delivered++
	}
	return delivered, failed, nil
}

// SendToChannel runs the retry loop for a single channel, writing a
// delivery_log entry per attempt. notificationID may be nil for ad-hoc
// (test-channel) sends.
//
// Returns nil on eventual success, or the last error on permanent /
// exhausted failure. Always writes at least one delivery_log row.
func (d *ChannelDispatcher) SendToChannel(ctx context.Context, ch *store.NotificationChannel, msg Message, notificationID *string) error {
	channelImpl, buildErr := d.buildChannel(ch)
	if buildErr != nil {
		// Malformed config — record as a single failed attempt and exit.
		d.appendLog(ctx, ch.TenantID, &ch.ID, notificationID, "failed", 1, ptrString(buildErr.Error()), msg)
		return buildErr
	}

	var (
		firstAttemptedAt = d.now()
		lastErr          error
	)
	maxAttempts := d.MaxRetries
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	delay := d.BaseBackoff
	if delay <= 0 {
		delay = 250 * time.Millisecond
	}
	maxBackoff := d.MaxBackoff
	if maxBackoff <= 0 {
		maxBackoff = 30 * time.Second
	}

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, d.PerAttemptTimeout)
		err := channelImpl.Send(attemptCtx, msg)
		cancel()

		now := d.now()
		if err == nil {
			d.appendLogFull(ctx, ch.TenantID, &ch.ID, notificationID, "delivered",
				int32(attempt), &firstAttemptedAt, &now, nil, msg)
			return nil
		}

		lastErr = err
		errMsg := err.Error()
		permanent := IsPermanent(err)

		status := "retrying"
		if permanent || attempt == maxAttempts {
			status = "failed"
		}
		d.appendLogFull(ctx, ch.TenantID, &ch.ID, notificationID, status,
			int32(attempt), &firstAttemptedAt, &now, &errMsg, msg)

		if permanent {
			d.Log.Warn("channel send: permanent failure",
				"channel_id", ch.ID, "kind", ch.Kind, "error", errMsg)
			return err
		}
		if attempt == maxAttempts {
			d.Log.Warn("channel send: exhausted retries",
				"channel_id", ch.ID, "kind", ch.Kind, "attempts", attempt, "error", errMsg)
			return err
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
		delay *= 2
		if delay > maxBackoff {
			delay = maxBackoff
		}
	}
	return lastErr
}

// buildChannel maps a stored NotificationChannel row to a Channel
// implementation. Unknown kinds return an ErrPermanent-wrapped error.
func (d *ChannelDispatcher) buildChannel(ch *store.NotificationChannel) (Channel, error) {
	switch ch.Kind {
	case "email":
		return NewEmailChannel(ch.Config, d.DefaultSMTPHost, d.DefaultSMTPPort)
	case "webhook":
		return NewWebhookChannel(ch.Config, d.HTTPClient)
	case "slack":
		return NewSlackChannel(ch.Config, d.HTTPClient)
	default:
		// Other kinds (pagerduty, teams, sms) are not implemented yet —
		// surfaced as permanent so the dispatcher records a clear log.
		return nil, ErrorPermanent(fmt.Errorf("channel kind %q not implemented", ch.Kind))
	}
}

// appendLog writes a single delivery-log entry. Any DB error is logged
// but not propagated — the delivery itself already happened (or didn't);
// log-write failure must not mask the send result.
func (d *ChannelDispatcher) appendLog(ctx context.Context, tenantID string, channelID, notificationID *string, status string, attempts int32, lastError *string, msg Message) {
	now := d.now()
	d.appendLogFull(ctx, tenantID, channelID, notificationID, status, attempts, &now, &now, lastError, msg)
}

func (d *ChannelDispatcher) appendLogFull(ctx context.Context, tenantID string, channelID, notificationID *string, status string, attempts int32, firstAttemptedAt, lastAttemptedAt *time.Time, lastError *string, msg Message) {
	tx, err := d.Store.Begin(ctx, store.TxOptions{})
	if err != nil {
		d.Log.Error("delivery log: begin tx", "error", err)
		return
	}
	metadata := map[string]any{
		"kind":     msg.Kind,
		"subject":  msg.Subject,
		"severity": msg.Severity,
	}
	if msg.Metadata != nil {
		metadata["userMetadata"] = msg.Metadata
	}
	metaBytes, _ := json.Marshal(metadata)
	entry := &store.NotificationDeliveryLogEntry{
		ID:               "ndl_" + uuid.NewString(),
		TenantID:         tenantID,
		ChannelID:        channelID,
		NotificationID:   notificationID,
		Status:           status,
		Attempts:         attempts,
		FirstAttemptedAt: firstAttemptedAt,
		LastAttemptedAt:  lastAttemptedAt,
		LastError:        lastError,
		Metadata:         string(metaBytes),
	}
	if _, err := tx.AppendDeliveryLogEntry(ctx, entry); err != nil {
		_ = tx.Rollback()
		d.Log.Error("delivery log: append", "error", err, "tenant_id", tenantID)
		return
	}
	if err := tx.Commit(); err != nil {
		d.Log.Error("delivery log: commit", "error", err, "tenant_id", tenantID)
	}
}

func ptrString(s string) *string { return &s }

// ErrChannelNotFound is returned by handleTestChannel for missing IDs.
var ErrChannelNotFound = errors.New("channel not found")
