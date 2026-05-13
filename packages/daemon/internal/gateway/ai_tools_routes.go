// Package gateway: AI tool handlers.
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

// ─── AI Tool handlers ───────────────────────────────────────────────────────

type aiToolResponse struct {
	ID           string          `json:"id"`
	TenantID     string          `json:"tenantId"`
	Name         string          `json:"name"`
	Kind         string          `json:"kind"`
	Description  string          `json:"description"`
	SchemaJSON   json.RawMessage `json:"schema"`
	HTTPEndpoint *string         `json:"httpEndpoint,omitempty"`
	MCPServerID  *string         `json:"mcpServerId,omitempty"`
	Dangerous    bool            `json:"dangerous"`
	Enabled      bool            `json:"enabled"`
	CreatedAt    string          `json:"createdAt"`
	UpdatedAt    string          `json:"updatedAt"`
}

func aiToolToResponse(x *store.AITool) aiToolResponse {
	return aiToolResponse{
		ID: x.ID, TenantID: x.TenantID, Name: x.Name, Kind: x.Kind, Description: x.Description,
		SchemaJSON:   rawOrEmpty(x.SchemaJSON, "{}"),
		HTTPEndpoint: x.HTTPEndpoint, MCPServerID: x.MCPServerID,
		Dangerous: x.Dangerous, Enabled: x.Enabled,
		CreatedAt: x.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: x.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleListAITools(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAIToolsByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list ai_tools")
		}
		out := make([]aiToolResponse, 0, len(items))
		for _, x := range items {
			out = append(out, aiToolToResponse(x))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateAITool(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Name         string          `json:"name"`
			Kind         string          `json:"kind"`
			Description  string          `json:"description,omitempty"`
			SchemaJSON   json.RawMessage `json:"schema,omitempty"`
			HTTPEndpoint *string         `json:"httpEndpoint,omitempty"`
			MCPServerID  *string         `json:"mcpServerId,omitempty"`
			Dangerous    bool            `json:"dangerous,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Name == "" || req.Kind == "" {
			return rerr.Validation(map[string]string{"name": "required", "kind": "required"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateAITool(r.Context(), &store.AITool{
			TenantID: tenant.ID, Name: req.Name, Kind: req.Kind, Description: req.Description,
			SchemaJSON: string(req.SchemaJSON), HTTPEndpoint: req.HTTPEndpoint, MCPServerID: req.MCPServerID,
			Dangerous: req.Dangerous, Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIToolNameTaken) {
				return rerr.Conflict("a tool with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create ai_tool")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, aiToolToResponse(created))
	}
}

func handleGetAITool(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		x, err := tx.GetAITool(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAIToolNotFound) {
				return rerr.NotFound("tool", id)
			}
			return rerr.Wrap(err, "get ai_tool")
		}
		return rerr.JSON(w, aiToolToResponse(x))
	}
}

func handleUpdateAITool(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			Name         *string          `json:"name,omitempty"`
			Kind         *string          `json:"kind,omitempty"`
			Description  *string          `json:"description,omitempty"`
			SchemaJSON   *json.RawMessage `json:"schema,omitempty"`
			HTTPEndpoint *string          `json:"httpEndpoint,omitempty"`
			MCPServerID  *string          `json:"mcpServerId,omitempty"`
			Dangerous    *bool            `json:"dangerous,omitempty"`
			Enabled      *bool            `json:"enabled,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		params := store.UpdateAIToolParams{
			Name: req.Name, Kind: req.Kind, Description: req.Description,
			HTTPEndpoint: req.HTTPEndpoint, MCPServerID: req.MCPServerID,
			Dangerous: req.Dangerous, Enabled: req.Enabled,
		}
		if req.SchemaJSON != nil {
			s := string(*req.SchemaJSON)
			params.SchemaJSON = &s
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateAITool(r.Context(), tenant.ID, id, params)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIToolNotFound) {
				return rerr.NotFound("tool", id)
			}
			return rerr.Wrap(err, "update ai_tool")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, aiToolToResponse(updated))
	}
}

func handleDeleteAITool(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteAITool(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIToolNotFound) {
				return rerr.NotFound("tool", id)
			}
			return rerr.Wrap(err, "delete ai_tool")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func handleTestAITool(_ store.Driver) rerr.Handler {
	// Stub — actual invocation lands with #103.
	return func(w http.ResponseWriter, r *http.Request) error {
		return rerr.JSON(w, map[string]any{
			"toolId": r.PathValue("id"), "ok": true,
			"note": "live tool invocation is stubbed",
		})
	}
}
