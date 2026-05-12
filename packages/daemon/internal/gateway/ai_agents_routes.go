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

func handleListAIAgents(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAIAgentsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list ai_agents")
			return
		}
		out := make([]aiAgentResponse, 0, len(items))
		for _, a := range items {
			out = append(out, aiAgentToResponse(a))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateAIAgent(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
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
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" {
			writeBadRequest(w, r, "name is required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateAIAgent(r.Context(), &store.AIAgent{
			TenantID: tenant.ID, ProviderID: req.ProviderID, Name: req.Name, Description: req.Description,
			Model: req.Model, SystemPrompt: req.SystemPrompt, Guardrails: string(req.Guardrails), Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIAgentNameTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"An agent with that name already exists in this tenant", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create ai_agent")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, aiAgentToResponse(created))
	}
}

func handleGetAIAgent(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		a, err := tx.GetAIAgent(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAIAgentNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Agent not found",
					"No agent with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get ai_agent")
			return
		}
		writeJSON(w, http.StatusOK, aiAgentToResponse(a))
	}
}

func handleUpdateAIAgent(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
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
			writeBadRequest(w, r, "invalid JSON body")
			return
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
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Agent not found",
					"No agent with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update ai_agent")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, aiAgentToResponse(updated))
	}
}

func handleDeleteAIAgent(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteAIAgent(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIAgentNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Agent not found",
					"No agent with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete ai_agent")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleListAgentBindings(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		agentID := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		// Cross-tenant guard.
		if _, err := tx.GetAIAgent(r.Context(), tenant.ID, agentID); err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Agent not found",
				"No agent with id "+agentID, r.URL.Path, nil)
			return
		}
		items, err := tx.ListAIToolBindingsByAgent(r.Context(), agentID)
		if err != nil {
			writeInternalError(w, r, "list bindings")
			return
		}
		out := make([]aiToolBindingResponse, 0, len(items))
		for _, b := range items {
			out = append(out, aiToolBindingToResponse(b))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleListAgentTraces(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		agentID := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.GetAIAgent(r.Context(), tenant.ID, agentID); err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Agent not found",
				"No agent with id "+agentID, r.URL.Path, nil)
			return
		}
		q := traceQueryFromRequest(r)
		items, err := tx.ListAITracesByAgent(r.Context(), agentID, q)
		if err != nil {
			writeInternalError(w, r, "list traces")
			return
		}
		out := make([]aiTraceResponse, 0, len(items))
		for _, tr := range items {
			out = append(out, aiTraceToResponse(tr, false))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleRotateAgentCredential(st store.Driver) http.HandlerFunc {
	// Stub — real implementation generates a new scoped credential.
	return func(w http.ResponseWriter, r *http.Request) {
		// Generate a stub rotation credential whose prefix is what the
		// admin UI displays once. Treated as opaque by the panel.
		now := time.Now().UTC().Format("20060102T150405")
		newCred := "sk-rot-" + now + "-" + r.PathValue("id")
		writeJSON(w, http.StatusOK, map[string]any{
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
func handleInvokeAIAgent(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		agentID := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		agent, err := tx.GetAIAgent(r.Context(), tenant.ID, agentID)
		_ = tx.Rollback()
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Agent not found",
				"No agent with id "+agentID, r.URL.Path, nil)
			return
		}

		var req struct {
			Prompt    string          `json:"prompt"`
			Variables json.RawMessage `json:"variables,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Prompt == "" {
			writeBadRequest(w, r, "prompt is required")
			return
		}

		flusher, fok := w.(http.Flusher)
		if !fok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

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
				return
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
	}
}
