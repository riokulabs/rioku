// Package gateway: AI tool-binding handlers.
//
// See `ai_routes.go` for the full route registration table.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/rerr"
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

func handleListAIToolBindings(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAIToolBindingsByTenant(r.Context(), tenant.ID)
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

func handleCreateAIToolBinding(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			AgentID   string `json:"agentId"`
			ToolID    string `json:"toolId"`
			Condition string `json:"condition,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.AgentID == "" || req.ToolID == "" {
			return rerr.Validation(map[string]string{"agentId": "required", "toolId": "required"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		// Cross-tenant guards on agent + tool.
		if _, err := tx.GetAIAgent(r.Context(), tenant.ID, req.AgentID); err != nil {
			_ = tx.Rollback()
			return rerr.NotFound("agent", req.AgentID)
		}
		if _, err := tx.GetAITool(r.Context(), tenant.ID, req.ToolID); err != nil {
			_ = tx.Rollback()
			return rerr.NotFound("tool", req.ToolID)
		}
		created, err := tx.CreateAIToolBinding(r.Context(), &store.AIToolBinding{
			TenantID: tenant.ID, AgentID: req.AgentID, ToolID: req.ToolID, Condition: req.Condition, Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIBindingExists) {
				return rerr.Conflict("that agent already has a binding to this tool", err)
			}
			return rerr.Wrap(err, "create binding")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusCreated)
		return rerr.JSON(w, aiToolBindingToResponse(created))
	}
}

func handleGetAIToolBinding(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		b, err := tx.GetAIToolBinding(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAIBindingNotFound) {
				return rerr.NotFound("binding", id)
			}
			return rerr.Wrap(err, "get binding")
		}
		return rerr.JSON(w, aiToolBindingToResponse(b))
	}
}

func handleUpdateAIToolBinding(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			Condition *string `json:"condition,omitempty"`
			Enabled   *bool   `json:"enabled,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateAIToolBinding(r.Context(), tenant.ID, id, store.UpdateAIToolBindingParams{
			Condition: req.Condition, Enabled: req.Enabled,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIBindingNotFound) {
				return rerr.NotFound("binding", id)
			}
			return rerr.Wrap(err, "update binding")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, aiToolBindingToResponse(updated))
	}
}

func handleDeleteAIToolBinding(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteAIToolBinding(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIBindingNotFound) {
				return rerr.NotFound("binding", id)
			}
			return rerr.Wrap(err, "delete binding")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func handleBulkAttachBindings(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			AgentID string   `json:"agentId"`
			ToolIDs []string `json:"toolIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.AgentID == "" {
			return rerr.Validation(map[string]string{"agentId": "required"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if _, err := tx.GetAIAgent(r.Context(), tenant.ID, req.AgentID); err != nil {
			_ = tx.Rollback()
			return rerr.NotFound("agent", req.AgentID)
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
				return rerr.Wrap(err, "bulk attach")
			}
			created = append(created, aiToolBindingToResponse(b))
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, map[string]any{"items": created, "total": len(created)})
	}
}
