// Package gateway: AI MCP server handlers (stage-2).
//
// See `ai_routes.go` for the full route registration table.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/store"
)

// ─── MCP servers ────────────────────────────────────────────────────────────

type mcpServerResponse struct {
	ID                 string          `json:"id"`
	TenantID           string          `json:"tenantId"`
	Name               string          `json:"name"`
	URL                string          `json:"url"`
	AuthKind           string          `json:"authKind"`
	Health             string          `json:"health"`
	Enabled            bool            `json:"enabled"`
	AuthorizedAgentIDs json.RawMessage `json:"authorizedAgentIds"`
	LastCheckedAt      *string         `json:"lastCheckedAt,omitempty"`
	CreatedAt          string          `json:"createdAt"`
	UpdatedAt          string          `json:"updatedAt"`
}

func mcpServerToResponse(s *store.AIMCPServer) mcpServerResponse {
	r := mcpServerResponse{
		ID: s.ID, TenantID: s.TenantID, Name: s.Name, URL: s.URL,
		AuthKind: s.AuthKind, Health: s.Health, Enabled: s.Enabled,
		AuthorizedAgentIDs: rawOrEmpty(s.AuthorizedAgentIDs, "[]"),
		CreatedAt:          s.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:          s.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if s.LastCheckedAt != nil {
		ts := s.LastCheckedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		r.LastCheckedAt = &ts
	}
	return r
}

func handleListMCPServers(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListMCPServersByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list mcp_servers")
			return
		}
		out := make([]mcpServerResponse, 0, len(items))
		for _, s := range items {
			out = append(out, mcpServerToResponse(s))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateMCPServer(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req struct {
			Name           string  `json:"name"`
			URL            string  `json:"url"`
			AuthKind       string  `json:"authKind,omitempty"`
			AuthCredential *string `json:"authCredential,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" || req.URL == "" {
			writeBadRequest(w, r, "name and url are required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateMCPServer(r.Context(), &store.AIMCPServer{
			TenantID: tenant.ID, Name: req.Name, URL: req.URL, AuthKind: req.AuthKind,
			AuthCredential: req.AuthCredential, Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrMCPServerNameTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"An MCP server with that name already exists in this tenant", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create mcp_server")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, mcpServerToResponse(created))
	}
}

func handleGetMCPServer(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		s, err := tx.GetMCPServer(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrMCPServerNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "MCP server not found",
					"No mcp_server with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get mcp_server")
			return
		}
		writeJSON(w, http.StatusOK, mcpServerToResponse(s))
	}
}

func handleUpdateMCPServer(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		var req struct {
			Name               *string          `json:"name,omitempty"`
			URL                *string          `json:"url,omitempty"`
			AuthKind           *string          `json:"authKind,omitempty"`
			AuthCredential     *string          `json:"authCredential,omitempty"`
			Enabled            *bool            `json:"enabled,omitempty"`
			AuthorizedAgentIDs *json.RawMessage `json:"authorizedAgentIds,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		params := store.UpdateAIMCPServerParams{
			Name: req.Name, URL: req.URL, AuthKind: req.AuthKind, AuthCredential: req.AuthCredential, Enabled: req.Enabled,
		}
		if req.AuthorizedAgentIDs != nil {
			s := string(*req.AuthorizedAgentIDs)
			params.AuthorizedAgentIDs = &s
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateMCPServer(r.Context(), tenant.ID, id, params)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrMCPServerNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "MCP server not found",
					"No mcp_server with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update mcp_server")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, mcpServerToResponse(updated))
	}
}

func handleDeleteMCPServer(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteMCPServer(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrMCPServerNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "MCP server not found",
					"No mcp_server with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete mcp_server")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleTestMCPServer(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Stage-2 stub like provider /test.
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		s, err := tx.GetMCPServer(r.Context(), tenant.ID, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "MCP server not found",
				"No mcp_server with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"mcpServerId": s.ID, "ok": true,
			"note": "live MCP connectivity check is stubbed in stage-2",
		})
	}
}
