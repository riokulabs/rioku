// Event-routing path: given an audit envelope, evaluate each tenant's
// active routing rules and fan out to the bound channels via the
// ChannelDispatcher.
//
// Stage-2 plan-06 wires this into the audit-emission path so that any
// audited mutation can drive notifications without requiring callers
// to know about routing rules. The wiring is async (per call goroutine)
// so the originating request never blocks on dispatch.
//
// EventFilter syntax (Plan 7 §11): `<category>.<subtype>` where each
// side is a slug or `*`. We do NOT use cel-go — the schema is a simple
// pattern-match that matches the web UI's eventFilterSchema.
package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/riokulabs/rioku/internal/store"
)

// AuditEnvelope is the kind-agnostic shape passed to EvaluateAndDispatch.
// It carries enough fields to (a) match an EventFilter, (b) build a
// Message for downstream channels.
type AuditEnvelope struct {
	// Kind is the canonical event kind, e.g. "service.created",
	// "audit.write", "rbac.role.escalate". Used by the channel-side
	// Message.Kind. Optional — derived from Category+Subtype if empty.
	Kind string

	// Category is the top-level bucket: "audit" | "security" | "system" |
	// "service" | "rbac" | etc. Matched against the LHS of EventFilter.
	Category string

	// Subtype refines the category: an audit operation ("create" |
	// "update" | "delete"), a severity ("info" | "warn" | "error" |
	// "success"), or an audit tier ("destructive" | "write" |
	// "read-sensitive"). Matched against the RHS of EventFilter.
	Subtype string

	// Severity is "info" | "warn" | "error" | "success". Optional.
	Severity string

	// Subject is a short headline for downstream channels.
	Subject string

	// Body is a longer description or diff summary.
	Body string

	// Actor identifies the user / system that triggered the event.
	Actor string

	// EntityType + EntityID identify the audited resource.
	EntityType string
	EntityID   string

	// Extra is opaque metadata merged into channel payloads.
	Extra map[string]any
}

// MatchesFilter reports whether `filter` matches `envelope`. The filter
// follows `<category>.<subtype>` grammar; either side may be `*`.
//
// Returns false (without error) when the filter is malformed; callers log
// and skip the rule.
func MatchesFilter(filter string, env AuditEnvelope) bool {
	parts := strings.SplitN(filter, ".", 2)
	if len(parts) != 2 {
		return false
	}
	cat, sub := parts[0], parts[1]
	if cat != "*" && !strings.EqualFold(cat, env.Category) {
		return false
	}
	if sub != "*" && !strings.EqualFold(sub, env.Subtype) {
		// fall back to severity match — `*.error` should hit
		// envelopes whose Severity is "error" regardless of Subtype.
		if !strings.EqualFold(sub, env.Severity) {
			return false
		}
	}
	return true
}

// EventRouter evaluates routing rules against an AuditEnvelope and
// dispatches matched rules to the ChannelDispatcher.
type EventRouter struct {
	Store      store.Driver
	Dispatcher *ChannelDispatcher
	Log        *slog.Logger
}

// NewEventRouter constructs an EventRouter wired to the given store and
// dispatcher. Both MUST be non-nil. log MAY be nil — a no-op handler
// is substituted.
func NewEventRouter(st store.Driver, dispatcher *ChannelDispatcher, log *slog.Logger) *EventRouter {
	if log == nil {
		log = slog.New(slog.NewTextHandler(discardWriter{}, nil))
	}
	return &EventRouter{Store: st, Dispatcher: dispatcher, Log: log}
}

// LoadRules returns the active routing rules for the given tenant,
// sorted by OrderHint ASC (driver-order). Disabled rules are filtered
// out. Returns an empty slice (not nil) on success with no rules.
func (r *EventRouter) LoadRules(ctx context.Context, tenantID string) ([]*store.NotificationRoutingRule, error) {
	tx, err := r.Store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("event_router: begin tx: %w", err)
	}
	rules, err := tx.ListRoutingRulesByTenant(ctx, tenantID)
	_ = tx.Rollback()
	if err != nil {
		return nil, fmt.Errorf("event_router: list rules: %w", err)
	}
	out := make([]*store.NotificationRoutingRule, 0, len(rules))
	for _, rule := range rules {
		if rule.Enabled {
			out = append(out, rule)
		}
	}
	return out, nil
}

// EvaluateAndDispatch loads active routing rules for `tenantID`, finds
// every rule whose EventFilter matches `env`, and dispatches the
// envelope to each rule's bound channels via the ChannelDispatcher.
//
// Per-channel send failures are logged (best-effort fan-out); only
// infrastructure errors (load rules) propagate. Returns the number of
// rules that matched + the number of (channel, send) attempts that
// resulted in delivery.
//
// Callers SHOULD invoke this from a goroutine to avoid blocking the
// originating request.
func (r *EventRouter) EvaluateAndDispatch(ctx context.Context, tenantID string, env AuditEnvelope) (matched int, delivered int, err error) {
	if r == nil || r.Dispatcher == nil {
		return 0, 0, nil
	}
	rules, err := r.LoadRules(ctx, tenantID)
	if err != nil {
		return 0, 0, err
	}
	if len(rules) == 0 {
		return 0, 0, nil
	}

	msg := envelopeToMessage(env)

	for _, rule := range rules {
		// Decode EventFilter — daemon stores JSON for forward compatibility,
		// but the stage-1/stage-2 grammar is a plain string. Try both.
		filter := decodeEventFilter(rule.EventFilter)
		if filter == "" {
			r.Log.Warn("event_router: empty event filter, skipping", "rule_id", rule.ID)
			continue
		}
		ok, syntaxErr := safeMatch(filter, env)
		if syntaxErr != nil {
			r.Log.Warn("event_router: malformed event filter, skipping",
				"rule_id", rule.ID, "filter", filter, "error", syntaxErr)
			continue
		}
		if !ok {
			continue
		}
		matched++

		channelIDs := decodeChannelIDs(rule.ChannelIDs)
		for _, chID := range channelIDs {
			ch, lookupErr := r.lookupChannel(ctx, tenantID, chID)
			if lookupErr != nil {
				r.Log.Warn("event_router: channel lookup failed",
					"rule_id", rule.ID, "channel_id", chID, "error", lookupErr)
				continue
			}
			if ch == nil || !ch.Enabled {
				continue
			}
			if sendErr := r.Dispatcher.SendToChannel(ctx, ch, msg, nil); sendErr != nil {
				r.Log.Info("event_router: channel send failed",
					"rule_id", rule.ID, "channel_id", chID, "error", sendErr)
				continue
			}
			delivered++
		}
	}
	return matched, delivered, nil
}

// AsyncEvaluateAndDispatch fires EvaluateAndDispatch on a fresh
// background goroutine and returns immediately. Errors are logged.
//
// This is the canonical entry point from the audit-emission path: the
// originating request commits its tx, then calls this to drive any
// resulting notifications without blocking the response.
func (r *EventRouter) AsyncEvaluateAndDispatch(tenantID string, env AuditEnvelope) {
	if r == nil || r.Dispatcher == nil {
		return
	}
	go func() {
		// Use a fresh background context — the originating request's
		// context may have been cancelled by the time we run.
		_, _, err := r.EvaluateAndDispatch(context.Background(), tenantID, env)
		if err != nil {
			r.Log.Error("event_router: async dispatch failed",
				"tenant_id", tenantID, "error", err)
		}
	}()
}

// lookupChannel reads a single notification channel; returns (nil, nil)
// if the channel is not found.
func (r *EventRouter) lookupChannel(ctx context.Context, tenantID, channelID string) (*store.NotificationChannel, error) {
	tx, err := r.Store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	ch, err := tx.GetNotificationChannel(ctx, tenantID, channelID)
	_ = tx.Rollback()
	if err != nil {
		return nil, err
	}
	return ch, nil
}

// envelopeToMessage projects an AuditEnvelope into a channel Message.
func envelopeToMessage(env AuditEnvelope) Message {
	severity := env.Severity
	if severity == "" {
		severity = "info"
	}
	kind := env.Kind
	if kind == "" {
		if env.Category != "" && env.Subtype != "" {
			kind = env.Category + "." + env.Subtype
		} else if env.Category != "" {
			kind = env.Category
		} else {
			kind = "audit"
		}
	}
	subject := env.Subject
	if subject == "" {
		subject = fmt.Sprintf("[%s] %s", strings.ToUpper(severity), kind)
	}
	meta := map[string]any{
		"actor":      env.Actor,
		"category":   env.Category,
		"subtype":    env.Subtype,
		"entityType": env.EntityType,
		"entityId":   env.EntityID,
	}
	for k, v := range env.Extra {
		meta[k] = v
	}
	return Message{
		Kind:     kind,
		Subject:  subject,
		Body:     env.Body,
		Severity: severity,
		Metadata: meta,
	}
}

// decodeEventFilter accepts either a raw `<cat>.<sub>` string or a JSON
// object {"expression": "..."} and returns the underlying expression.
// Unknown shapes fall back to the trimmed raw string.
func decodeEventFilter(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" {
		return ""
	}
	if strings.HasPrefix(raw, "{") {
		var obj struct {
			Expression string `json:"expression"`
			EventKind  string `json:"event_kind"`
			Filter     string `json:"filter"`
		}
		if err := json.Unmarshal([]byte(raw), &obj); err == nil {
			switch {
			case obj.Expression != "":
				return obj.Expression
			case obj.Filter != "":
				return obj.Filter
			case obj.EventKind != "":
				return obj.EventKind
			}
		}
		return ""
	}
	return raw
}

// decodeChannelIDs returns the channel-id list. Accepts either a JSON
// array or a comma-separated list (forward-compat).
func decodeChannelIDs(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if strings.HasPrefix(raw, "[") {
		var ids []string
		if err := json.Unmarshal([]byte(raw), &ids); err == nil {
			return ids
		}
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// safeMatch wraps MatchesFilter with explicit syntax validation so
// callers can distinguish "no match" from "broken filter".
func safeMatch(filter string, env AuditEnvelope) (bool, error) {
	parts := strings.SplitN(filter, ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false, fmt.Errorf("event_filter %q: expected <category>.<subtype>", filter)
	}
	return MatchesFilter(filter, env), nil
}

// discardWriter is a tiny io.Writer that discards everything; used as
// the slog target when callers pass a nil logger.
type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
