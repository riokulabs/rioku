// Package gateway: AI semantic rate-limit handlers.
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

// ─── Rate limit handlers ────────────────────────────────────────────────────

type aiRateLimitResponse struct {
	ID                  string          `json:"id"`
	TenantID            string          `json:"tenantId"`
	Name                string          `json:"name"`
	Scope               string          `json:"scope"`
	AgentID             *string         `json:"agentId,omitempty"`
	ToolID              *string         `json:"toolId,omitempty"`
	Exemplars           json.RawMessage `json:"exemplars"`
	SimilarityThreshold float64         `json:"similarityThreshold"`
	WindowSeconds       int32           `json:"windowSeconds"`
	Threshold           int32           `json:"threshold"`
	Action              string          `json:"action"`
	Enabled             bool            `json:"enabled"`
	CreatedAt           string          `json:"createdAt"`
	UpdatedAt           string          `json:"updatedAt"`
}

func aiRateLimitToResponse(rl *store.AISemanticRateLimit) aiRateLimitResponse {
	return aiRateLimitResponse{
		ID: rl.ID, TenantID: rl.TenantID, Name: rl.Name, Scope: rl.Scope, AgentID: rl.AgentID, ToolID: rl.ToolID,
		Exemplars:           rawOrEmpty(rl.Exemplars, "[]"),
		SimilarityThreshold: rl.SimilarityThreshold, WindowSeconds: rl.WindowSeconds,
		Threshold: rl.Threshold, Action: rl.Action, Enabled: rl.Enabled,
		CreatedAt: rl.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: rl.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleListAIRateLimits(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAIRateLimitsByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list rate_limits")
		}
		out := make([]aiRateLimitResponse, 0, len(items))
		for _, rl := range items {
			out = append(out, aiRateLimitToResponse(rl))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateAIRateLimit(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Name                string          `json:"name"`
			Scope               string          `json:"scope"`
			AgentID             *string         `json:"agentId,omitempty"`
			ToolID              *string         `json:"toolId,omitempty"`
			Exemplars           json.RawMessage `json:"exemplars,omitempty"`
			SimilarityThreshold float64         `json:"similarityThreshold,omitempty"`
			WindowSeconds       int32           `json:"windowSeconds,omitempty"`
			Threshold           int32           `json:"threshold,omitempty"`
			Action              string          `json:"action,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Name == "" || req.Scope == "" {
			return rerr.Validation(map[string]string{"name": "required", "scope": "required"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateAIRateLimit(r.Context(), &store.AISemanticRateLimit{
			TenantID: tenant.ID, Name: req.Name, Scope: req.Scope, AgentID: req.AgentID, ToolID: req.ToolID,
			Exemplars: string(req.Exemplars), SimilarityThreshold: req.SimilarityThreshold,
			WindowSeconds: req.WindowSeconds, Threshold: req.Threshold, Action: req.Action, Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIRateLimitNameTaken) {
				return rerr.Conflict("a rate limit with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create rate_limit")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusCreated)
		return rerr.JSON(w, aiRateLimitToResponse(created))
	}
}

func handleGetAIRateLimit(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		rl, err := tx.GetAIRateLimit(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAIRateLimitNotFound) {
				return rerr.NotFound("rate_limit", id)
			}
			return rerr.Wrap(err, "get rate_limit")
		}
		return rerr.JSON(w, aiRateLimitToResponse(rl))
	}
}

func handleUpdateAIRateLimit(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			Name                *string          `json:"name,omitempty"`
			Scope               *string          `json:"scope,omitempty"`
			AgentID             *string          `json:"agentId,omitempty"`
			ToolID              *string          `json:"toolId,omitempty"`
			Exemplars           *json.RawMessage `json:"exemplars,omitempty"`
			SimilarityThreshold *float64         `json:"similarityThreshold,omitempty"`
			WindowSeconds       *int32           `json:"windowSeconds,omitempty"`
			Threshold           *int32           `json:"threshold,omitempty"`
			Action              *string          `json:"action,omitempty"`
			Enabled             *bool            `json:"enabled,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		params := store.UpdateAIRateLimitParams{
			Name: req.Name, Scope: req.Scope, AgentID: req.AgentID, ToolID: req.ToolID,
			SimilarityThreshold: req.SimilarityThreshold, WindowSeconds: req.WindowSeconds,
			Threshold: req.Threshold, Action: req.Action, Enabled: req.Enabled,
		}
		if req.Exemplars != nil {
			s := string(*req.Exemplars)
			params.Exemplars = &s
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateAIRateLimit(r.Context(), tenant.ID, id, params)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIRateLimitNotFound) {
				return rerr.NotFound("rate_limit", id)
			}
			return rerr.Wrap(err, "update rate_limit")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, aiRateLimitToResponse(updated))
	}
}

func handleDeleteAIRateLimit(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteAIRateLimit(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIRateLimitNotFound) {
				return rerr.NotFound("rate_limit", id)
			}
			return rerr.Wrap(err, "delete rate_limit")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}
