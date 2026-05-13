// Package gateway: AI trace handlers.
//
// Traces are append-only from the daemon invoke path; this file exposes
// the read-side endpoints (list + get). The shared `traceQueryFromRequest`
// helper is also consumed by `handleListAgentTraces` in
// `ai_agents_routes.go`.
//
// See `ai_routes.go` for the full route registration table.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
	storeaudit "github.com/riokulabs/rioku/internal/store/audit"
)

// ─── Trace handlers ─────────────────────────────────────────────────────────

type aiTraceResponse struct {
	ID            string          `json:"id"`
	TenantID      string          `json:"tenantId"`
	AgentID       *string         `json:"agentId,omitempty"`
	ProviderID    *string         `json:"providerId,omitempty"`
	Model         string          `json:"model"`
	Status        string          `json:"status"`
	InputTokens   int32           `json:"inputTokens"`
	OutputTokens  int32           `json:"outputTokens"`
	DurationMS    int32           `json:"durationMs"`
	Prompt        *string         `json:"prompt,omitempty"`     // gated
	Completion    *string         `json:"completion,omitempty"` // gated
	ToolCallsJSON json.RawMessage `json:"toolCalls"`
	Error         *string         `json:"error,omitempty"`
	OccurredAt    string          `json:"occurredAt"`
}

func aiTraceToResponse(t *store.AITrace, includeSensitive bool) aiTraceResponse {
	r := aiTraceResponse{
		ID: t.ID, TenantID: t.TenantID, AgentID: t.AgentID, ProviderID: t.ProviderID,
		Model: t.Model, Status: t.Status, InputTokens: t.InputTokens, OutputTokens: t.OutputTokens,
		DurationMS: t.DurationMS, ToolCallsJSON: rawOrEmpty(t.ToolCallsJSON, "[]"),
		Error: t.Error, OccurredAt: t.OccurredAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if includeSensitive {
		r.Prompt = t.Prompt
		r.Completion = t.Completion
	}
	return r
}

func traceQueryFromRequest(r *http.Request) store.AITraceQuery {
	q := store.AITraceQuery{}
	if s := r.URL.Query().Get("status"); s != "" {
		q.Status = &s
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			q.Limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			q.Offset = n
		}
	}
	return q
}

func handleListAITraces(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAITracesByTenant(r.Context(), tenant.ID, traceQueryFromRequest(r))
		if err != nil {
			return rerr.Wrap(err, "list traces")
		}
		out := make([]aiTraceResponse, 0, len(items))
		for _, tr := range items {
			out = append(out, aiTraceToResponse(tr, false))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleGetAITrace(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		tr, err := tx.GetAITrace(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAITraceNotFound) {
				return rerr.NotFound("trace", id)
			}
			return rerr.Wrap(err, "get trace")
		}
		// GET returns the redacted shape; sensitive fields require POST
		// .../reveal with a compliance reason (see handleRevealAITrace).
		return rerr.JSON(w, aiTraceToResponse(tr, false))
	}
}

// handleRevealAITrace returns the full trace including sensitive prompt /
// completion fields. Access is gated by `ai-trace:read-sensitive` at the
// route layer AND requires a non-trivial reason in the request body.
// Each successful reveal appends an `ai.trace_sensitive_revealed.v1`
// audit entry in the same transaction so the unmask is permanently
// recorded for compliance review.
func handleRevealAITrace(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")

		var body struct {
			Reason string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return rerr.Validation(map[string]string{"body": "must be JSON with a `reason` field"})
		}
		reason := strings.TrimSpace(body.Reason)
		// 10 chars is the contract documented in the test fixtures: short
		// reasons like "ok" or "too short" are rejected so reviewers
		// always see something usable.
		if len(reason) < 10 {
			return rerr.Validation(map[string]string{"reason": "must be at least 10 characters"})
		}

		actor := "system"
		if sc := auth.SessionClaimsFromContext(ctx); sc != nil && sc.UserID != "" {
			actor = sc.UserID
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		tr, err := tx.GetAITrace(ctx, tenant.ID, id)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAITraceNotFound) {
				return rerr.NotFound("trace", id)
			}
			return rerr.Wrap(err, "reveal trace")
		}

		entry, err := storeaudit.BuildEntry(
			storeaudit.DefaultRegistry,
			actor,
			"ai-trace",
			id,
			"reveal",
			&storeaudit.AITraceSensitiveRevealed{
				RevealedTraceID: id,
				Reason:          reason,
			},
		)
		if err != nil {
			_ = tx.Rollback()
			return rerr.Wrap(err, "build reveal audit entry")
		}
		_ = tenant // tenant scoping happens at the route layer; AuditEntry has no per-row tenant column today
		if err := tx.AppendAuditEntry(ctx, entry); err != nil {
			_ = tx.Rollback()
			return rerr.Wrap(err, "persist reveal audit entry")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit reveal audit entry")
		}

		return rerr.JSON(w, aiTraceToResponse(tr, true))
	}
}
