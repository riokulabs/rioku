// Package gateway: AI MCP server handlers.
//
// See `ai_routes.go` for the full route registration table.
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/riokulabs/rioku/internal/rerr"
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

func handleListMCPServers(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListMCPServersByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list mcp_servers")
		}
		out := make([]mcpServerResponse, 0, len(items))
		for _, s := range items {
			out = append(out, mcpServerToResponse(s))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateMCPServer(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Name           string  `json:"name"`
			URL            string  `json:"url"`
			AuthKind       string  `json:"authKind,omitempty"`
			AuthCredential *string `json:"authCredential,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Name == "" || req.URL == "" {
			return rerr.Validation(map[string]string{"name": "required", "url": "required"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateMCPServer(r.Context(), &store.AIMCPServer{
			TenantID: tenant.ID, Name: req.Name, URL: req.URL, AuthKind: req.AuthKind,
			AuthCredential: req.AuthCredential, Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrMCPServerNameTaken) {
				return rerr.Conflict("an MCP server with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create mcp_server")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusCreated)
		return rerr.JSON(w, mcpServerToResponse(created))
	}
}

func handleGetMCPServer(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		s, err := tx.GetMCPServer(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrMCPServerNotFound) {
				return rerr.NotFound("mcp_server", id)
			}
			return rerr.Wrap(err, "get mcp_server")
		}
		return rerr.JSON(w, mcpServerToResponse(s))
	}
}

func handleUpdateMCPServer(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
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
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
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
				return rerr.NotFound("mcp_server", id)
			}
			return rerr.Wrap(err, "update mcp_server")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, mcpServerToResponse(updated))
	}
}

func handleDeleteMCPServer(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteMCPServer(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrMCPServerNotFound) {
				return rerr.NotFound("mcp_server", id)
			}
			return rerr.Wrap(err, "delete mcp_server")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// handleTestMCPServer issues a live(ish) connectivity probe against the MCP
// server's configured URL. Performs a best-effort HTTP HEAD/GET against the
// registered URL, with a short timeout. The shape is stable:
//
//	{ ok: bool, latencyMs: number, error?: string, serverVersion?: string,
//	  mcpServerId: string }
//
// `latencyMs` is always populated (probe duration). `error` is set on failure
// (timeout, non-2xx, network error). `serverVersion` is populated from the
// upstream `Server` response header when present (typical for HTTP servers).
func handleTestMCPServer(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		s, err := tx.GetMCPServer(r.Context(), tenant.ID, id)
		if err != nil {
			return rerr.NotFound("mcp_server", id)
		}

		probe := probeMCPConnectivity(r.Context(), s.URL)
		resp := map[string]any{
			"mcpServerId": s.ID,
			"ok":          probe.ok,
			"latencyMs":   probe.latencyMs,
		}
		if probe.err != "" {
			resp["error"] = probe.err
		}
		if probe.serverVersion != "" {
			resp["serverVersion"] = probe.serverVersion
		}
		return rerr.JSON(w, resp)
	}
}

// mcpProbeResult captures the outcome of a connectivity probe.
type mcpProbeResult struct {
	ok            bool
	latencyMs     int64
	err           string
	serverVersion string
}

// probeMCPConnectivity runs a short HTTP probe and returns a structured result.
// Any non-network failure (parse errors, non-2xx) is reported via `err` with
// `ok=false`. Successful probes set `ok=true` and capture `Server` header when
// the upstream advertises one.
func probeMCPConnectivity(ctx context.Context, rawURL string) mcpProbeResult {
	if rawURL == "" {
		return mcpProbeResult{ok: false, latencyMs: 0, err: "no URL configured"}
	}

	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, probeErr := http.NewRequestWithContext(probeCtx, http.MethodGet, rawURL, nil)
	if probeErr != nil {
		return mcpProbeResult{ok: false, latencyMs: 0, err: "invalid URL: " + probeErr.Error()}
	}
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	start := time.Now()
	res, herr := client.Do(req)
	latency := time.Since(start).Milliseconds()
	if herr != nil {
		return mcpProbeResult{ok: false, latencyMs: latency, err: herr.Error()}
	}
	defer func() { _ = res.Body.Close() }()

	out := mcpProbeResult{
		latencyMs:     latency,
		serverVersion: res.Header.Get("Server"),
	}
	if res.StatusCode >= 200 && res.StatusCode < 500 {
		// Treat 2xx/3xx/4xx as "reachable" — many MCP endpoints return 401/404
		// to a bare GET but are still up.
		out.ok = true
	} else {
		out.ok = false
		out.err = "upstream returned status " + strconv.Itoa(res.StatusCode)
	}
	return out
}
