// Package gateway: AI agent handlers.
//
// Includes per-agent nested resources: tool bindings list, traces list,
// and the rotate-credential stub. Bindings + trace types live in
// `ai_tool_bindings_routes.go` and `ai_traces_routes.go` respectively.
//
// See `ai_routes.go` for the full route registration table.
package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// ─── Agent handlers ─────────────────────────────────────────────────────────

type aiAgentResponse struct {
	ID           string          `json:"id"`
	TenantID     string          `json:"tenantId"`
	ProviderID   *string         `json:"providerId,omitempty"`
	Name         string          `json:"name"`
	Description  string          `json:"description"`
	Model        string          `json:"model"`
	SystemPrompt string          `json:"systemPrompt"`
	Guardrails   json.RawMessage `json:"guardrails"`
	Enabled      bool            `json:"enabled"`
	CreatedAt    string          `json:"createdAt"`
	UpdatedAt    string          `json:"updatedAt"`
}

func aiAgentToResponse(a *store.AIAgent) aiAgentResponse {
	return aiAgentResponse{
		ID: a.ID, TenantID: a.TenantID, ProviderID: a.ProviderID, Name: a.Name,
		Description: a.Description, Model: a.Model, SystemPrompt: a.SystemPrompt,
		Guardrails: rawOrEmpty(a.Guardrails, "{}"), Enabled: a.Enabled,
		CreatedAt: a.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: a.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleListAIAgents(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAIAgentsByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list ai_agents")
		}
		out := make([]aiAgentResponse, 0, len(items))
		for _, a := range items {
			out = append(out, aiAgentToResponse(a))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateAIAgent(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			ProviderID   *string         `json:"providerId,omitempty"`
			Name         string          `json:"name"`
			Description  string          `json:"description,omitempty"`
			Model        string          `json:"model,omitempty"`
			SystemPrompt string          `json:"systemPrompt,omitempty"`
			Guardrails   json.RawMessage `json:"guardrails,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Name == "" {
			return rerr.Validation(map[string]string{"name": "required"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateAIAgent(r.Context(), &store.AIAgent{
			TenantID: tenant.ID, ProviderID: req.ProviderID, Name: req.Name, Description: req.Description,
			Model: req.Model, SystemPrompt: req.SystemPrompt, Guardrails: string(req.Guardrails), Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIAgentNameTaken) {
				return rerr.Conflict("an agent with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create ai_agent")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, aiAgentToResponse(created))
	}
}

func handleGetAIAgent(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		a, err := tx.GetAIAgent(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAIAgentNotFound) {
				return rerr.NotFound("agent", id)
			}
			return rerr.Wrap(err, "get ai_agent")
		}
		return rerr.JSON(w, aiAgentToResponse(a))
	}
}

func handleUpdateAIAgent(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			ProviderID   *string          `json:"providerId,omitempty"`
			Name         *string          `json:"name,omitempty"`
			Description  *string          `json:"description,omitempty"`
			Model        *string          `json:"model,omitempty"`
			SystemPrompt *string          `json:"systemPrompt,omitempty"`
			Guardrails   *json.RawMessage `json:"guardrails,omitempty"`
			Enabled      *bool            `json:"enabled,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		params := store.UpdateAIAgentParams{
			ProviderID: req.ProviderID, Name: req.Name, Description: req.Description,
			Model: req.Model, SystemPrompt: req.SystemPrompt, Enabled: req.Enabled,
		}
		if req.Guardrails != nil {
			s := string(*req.Guardrails)
			params.Guardrails = &s
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateAIAgent(r.Context(), tenant.ID, id, params)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIAgentNotFound) {
				return rerr.NotFound("agent", id)
			}
			return rerr.Wrap(err, "update ai_agent")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, aiAgentToResponse(updated))
	}
}

func handleDeleteAIAgent(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteAIAgent(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIAgentNotFound) {
				return rerr.NotFound("agent", id)
			}
			return rerr.Wrap(err, "delete ai_agent")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func handleListAgentBindings(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		agentID := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		// Cross-tenant guard.
		if _, err := tx.GetAIAgent(r.Context(), tenant.ID, agentID); err != nil {
			return rerr.NotFound("agent", agentID)
		}
		items, err := tx.ListAIToolBindingsByAgent(r.Context(), agentID)
		if err != nil {
			return rerr.Wrap(err, "list bindings")
		}
		out := make([]aiToolBindingResponse, 0, len(items))
		for _, b := range items {
			out = append(out, aiToolBindingToResponse(b))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleListAgentTraces(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		agentID := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.GetAIAgent(r.Context(), tenant.ID, agentID); err != nil {
			return rerr.NotFound("agent", agentID)
		}
		q := traceQueryFromRequest(r)
		items, err := tx.ListAITracesByAgent(r.Context(), agentID, q)
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

func handleRotateAgentCredential(_ store.Driver) rerr.Handler {
	// Stub — real implementation generates a new scoped credential.
	return func(w http.ResponseWriter, r *http.Request) error {
		// Generate a stub rotation credential whose prefix is what the
		// admin UI displays once. Treated as opaque by the panel.
		now := time.Now().UTC().Format("20060102T150405")
		newCred := "sk-rot-" + now + "-" + r.PathValue("id")
		return rerr.JSON(w, map[string]any{
			"agentId":       r.PathValue("id"),
			"ok":            true,
			"newCredential": newCred,
			"prefix":        newCred[:min(12, len(newCred))],
			"note":          "scoped credential rotation is stubbed",
		})
	}
}

// handleInvokeAIAgent streams a stub completion as Server-Sent Events.
//
// Request: POST /api/v1/t/{tenant}/ai/agents/{id}/invoke
// Body:    {"prompt": "...", "variables": {...}}
// Response: text/event-stream with `event: chunk` frames carrying small
//
//	text fragments, terminated by `event: done` carrying token + cost
//	summary, or `event: error` on failure.
//
// Currently a stub; real implementations will route through the configured
// provider's streaming completion API.
func handleInvokeAIAgent(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		agentID := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		agent, err := tx.GetAIAgent(r.Context(), tenant.ID, agentID)
		_ = tx.Rollback()
		if err != nil {
			return rerr.NotFound("agent", agentID)
		}

		var req struct {
			Prompt    string          `json:"prompt"`
			Variables json.RawMessage `json:"variables,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Prompt == "" {
			return rerr.Validation(map[string]string{"prompt": "required"})
		}

		flusher, fok := w.(http.Flusher)
		if !fok {
			// rerr-skip: non-SSE environment; cannot use rerr after http.Error
			http.Error(w, "streaming not supported", http.StatusInternalServerError) //nolint:forbidigo // SSE fallback path
			return nil
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		// rerr-skip: response already started; errors below cannot be returned.
		chunks := []string{
			"Routing prompt to ",
			agent.Model,
			" via agent ",
			agent.Name,
			". ",
			"Generating response… ",
			"This is a stub completion produced by the invoke handler.",
		}
		start := time.Now()
		for i, c := range chunks {
			select {
			case <-r.Context().Done():
				return nil
			default:
			}
			payload, _ := json.Marshal(map[string]any{
				"index": i,
				"text":  c,
			})
			_, _ = fmt.Fprintf(w, "event: chunk\ndata: %s\n\n", payload)
			flusher.Flush()
			time.Sleep(20 * time.Millisecond)
		}
		done, _ := json.Marshal(map[string]any{
			"latencyMs":    time.Since(start).Milliseconds(),
			"inputTokens":  len(req.Prompt) / 4,
			"outputTokens": 32,
			"costUsd":      0.0001,
			"status":       "success",
		})
		_, _ = fmt.Fprintf(w, "event: done\ndata: %s\n\n", done)
		flusher.Flush()
		return nil
	}
}
