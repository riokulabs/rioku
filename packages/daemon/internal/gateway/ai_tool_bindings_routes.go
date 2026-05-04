// Package gateway: AI tool-binding handlers (stage-2).
//
// See `ai_routes.go` for the full route registration table.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/store"
)

// ─── Tool binding handlers ──────────────────────────────────────────────────

type aiToolBindingResponse struct {
	ID        string `json:"id"`
	TenantID  string `json:"tenantId"`
	AgentID   string `json:"agentId"`
	ToolID    string `json:"toolId"`
	Condition string `json:"condition"`
	Enabled   bool   `json:"enabled"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func aiToolBindingToResponse(b *store.AIToolBinding) aiToolBindingResponse {
	return aiToolBindingResponse{
		ID: b.ID, TenantID: b.TenantID, AgentID: b.AgentID, ToolID: b.ToolID,
		Condition: b.Condition, Enabled: b.Enabled,
		CreatedAt: b.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: b.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleListAIToolBindings(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAIToolBindingsByTenant(r.Context(), tenant.ID)
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

func handleCreateAIToolBinding(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req struct {
			AgentID   string `json:"agentId"`
			ToolID    string `json:"toolId"`
			Condition string `json:"condition,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.AgentID == "" || req.ToolID == "" {
			writeBadRequest(w, r, "agentId and toolId are required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		// Cross-tenant guards on agent + tool.
		if _, err := tx.GetAIAgent(r.Context(), tenant.ID, req.AgentID); err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Agent not found",
				"No agent with id "+req.AgentID, r.URL.Path, nil)
			return
		}
		if _, err := tx.GetAITool(r.Context(), tenant.ID, req.ToolID); err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Tool not found",
				"No tool with id "+req.ToolID, r.URL.Path, nil)
			return
		}
		created, err := tx.CreateAIToolBinding(r.Context(), &store.AIToolBinding{
			TenantID: tenant.ID, AgentID: req.AgentID, ToolID: req.ToolID, Condition: req.Condition, Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIBindingExists) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Binding already exists",
					"That agent already has a binding to this tool", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create binding")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, aiToolBindingToResponse(created))
	}
}

func handleGetAIToolBinding(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		b, err := tx.GetAIToolBinding(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAIBindingNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Binding not found",
					"No binding with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get binding")
			return
		}
		writeJSON(w, http.StatusOK, aiToolBindingToResponse(b))
	}
}

func handleUpdateAIToolBinding(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		var req struct {
			Condition *string `json:"condition,omitempty"`
			Enabled   *bool   `json:"enabled,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateAIToolBinding(r.Context(), tenant.ID, id, store.UpdateAIToolBindingParams{
			Condition: req.Condition, Enabled: req.Enabled,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIBindingNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Binding not found",
					"No binding with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update binding")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, aiToolBindingToResponse(updated))
	}
}

func handleDeleteAIToolBinding(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteAIToolBinding(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIBindingNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Binding not found",
					"No binding with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete binding")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleBulkAttachBindings(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req struct {
			AgentID string   `json:"agentId"`
			ToolIDs []string `json:"toolIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.AgentID == "" {
			writeBadRequest(w, r, "agentId is required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if _, err := tx.GetAIAgent(r.Context(), tenant.ID, req.AgentID); err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Agent not found",
				"No agent with id "+req.AgentID, r.URL.Path, nil)
			return
		}
		created := make([]aiToolBindingResponse, 0, len(req.ToolIDs))
		for _, toolID := range req.ToolIDs {
			if _, err := tx.GetAITool(r.Context(), tenant.ID, toolID); err != nil {
				continue // silently skip cross-tenant or missing tools
			}
			b, err := tx.CreateAIToolBinding(r.Context(), &store.AIToolBinding{
				TenantID: tenant.ID, AgentID: req.AgentID, ToolID: toolID, Enabled: true,
			})
			if err != nil {
				if errors.Is(err, store.ErrAIBindingExists) {
					continue // idempotent on duplicates
				}
				_ = tx.Rollback()
				writeInternalError(w, r, "bulk attach")
				return
			}
			created = append(created, aiToolBindingToResponse(b))
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": created, "total": len(created)})
	}
}
