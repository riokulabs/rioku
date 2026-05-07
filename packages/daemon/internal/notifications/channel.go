// Channel send-side dispatcher (stage-2 plan-06 / decisions-needed item 001).
//
// This file declares the Channel interface that every outbound delivery
// destination (email, webhook, slack, ...) implements, plus the Message
// envelope all channels accept. The per-kind implementations live in
// email_channel.go, webhook_channel.go, etc.
//
// Note: this is the "channel send-side" path used by the test-channel
// REST endpoint and the routing-rule fan-out. It is separate from the
// existing Dispatcher in dispatcher.go which fans out api-management
// state-change events to webhook_endpoints rows (a different table and
// a different feature). Both live in package notifications but have no
// runtime overlap — the api-management webhook fan-out is for operator
// integrations; the channel dispatcher here is for tenant notification
// delivery to user-configured channels (email/slack/webhook).
package notifications

import (
	"context"
	"errors"
	"fmt"
)

// Message is the kind-agnostic envelope passed to every Channel.
// Channel implementations adapt the message to their wire format
// (RFC822 mail body for email, JSON POST for webhook, slack block-kit
// payload for slack, etc.).
type Message struct {
	// Kind classifies the originating event ("test" | "alert" |
	// "audit" | "user-event"). Channels MAY use this to suppress
	// or rewrite payloads; "test" messages always include a
	// "Test from Rioku" subject for clarity.
	Kind string

	// Subject is the short headline (mail subject, slack fallback
	// text, webhook envelope.subject).
	Subject string

	// Body is the long-form payload. Channels MAY truncate.
	Body string

	// Severity is one of "info" | "warn" | "error" | "critical".
	// Empty means "info".
	Severity string

	// Metadata is an opaque map merged into the channel-specific
	// payload (webhook envelope.metadata, slack attachments fields,
	// email X-* headers). Keys MUST be ASCII identifiers; values
	// MUST be JSON-marshallable.
	Metadata map[string]any
}

// Channel is the narrow interface every outbound destination
// implements. Send is synchronous; the dispatcher handles retries
// and delivery-log writes.
//
// Send MUST return a non-nil error on transient failure (network,
// 5xx upstream, SMTP 4xx) — the dispatcher will retry. Permanent
// failures (4xx upstream, SMTP 5xx, malformed config) SHOULD wrap
// ErrPermanent so the dispatcher skips the retry loop.
type Channel interface {
	// Kind returns the channel-kind discriminator
	// ("email" | "slack" | "webhook" | ...).
	Kind() string

	// Send delivers msg. The context carries the per-attempt
	// deadline; implementations MUST honour ctx.Done().
	Send(ctx context.Context, msg Message) error
}

// ErrPermanent wraps a non-retryable channel error. Channel
// implementations should return `fmt.Errorf("...: %w", ErrPermanent)`
// or use ErrorPermanent(err) below for clarity.
var ErrPermanent = errors.New("permanent channel error")

// ErrorPermanent wraps err so dispatcher.IsPermanent(err) returns true.
// Channel impls call this when they detect an unambiguously permanent
// failure (HTTP 4xx, SMTP 5xx, malformed config).
func ErrorPermanent(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w: %s", ErrPermanent, err.Error())
}

// IsPermanent reports whether err is a non-retryable channel error.
func IsPermanent(err error) bool { return errors.Is(err, ErrPermanent) }
