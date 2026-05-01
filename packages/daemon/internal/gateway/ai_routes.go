// Package gateway: AI subsystem REST endpoints (stage-2).
//
// Routes (all under /api/v1/t/{tenant}/ai/...):
//
//	providers (CRUD + /test + nested /models)
//	agents    (CRUD + /tools + /traces + /rotate-credential + /invoke)
//	tools     (CRUD + /test + /agents)
//	tool-bindings (CRUD + /bulk-attach + /preview-condition)
//	rate-limits   (CRUD + /simulate + /metrics)
//	traces        (list + get + /export/csv)  [append-only]
//	mcp-servers   (CRUD + /test + /tools)
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/riokulabs/rioku/internal/store"
)

func RegisterAIRoutes(mux *http.ServeMux, st store.Driver) {
	// Providers
	mux.Handle("GET /api/v1/t/{tenant}/ai/providers",
		RequirePermission("ai-provider:read")(http.HandlerFunc(handleListAIProviders(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/providers",
		RequirePermission("ai-provider:write")(http.HandlerFunc(handleCreateAIProvider(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/providers/{id}",
		RequirePermission("ai-provider:read")(http.HandlerFunc(handleGetAIProvider(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/providers/{id}",
		RequirePermission("ai-provider:write")(http.HandlerFunc(handleUpdateAIProvider(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/providers/{id}",
		RequirePermission("ai-provider:delete")(http.HandlerFunc(handleDeleteAIProvider(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/providers/{id}/test",
		RequirePermission("ai-provider:read")(http.HandlerFunc(handleTestAIProvider(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/providers/{id}/models",
		RequirePermission("ai-provider:write")(http.HandlerFunc(handleAddProviderModel(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/providers/{id}/models/{modelId}",
		RequirePermission("ai-provider:write")(http.HandlerFunc(handleUpdateProviderModel(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/providers/{id}/models/{modelId}",
		RequirePermission("ai-provider:write")(http.HandlerFunc(handleRemoveProviderModel(st))))

	// MCP servers
	mux.Handle("GET /api/v1/t/{tenant}/ai/mcp-servers",
		RequirePermission("mcp-server:read")(http.HandlerFunc(handleListMCPServers(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/mcp-servers",
		RequirePermission("mcp-server:write")(http.HandlerFunc(handleCreateMCPServer(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/mcp-servers/{id}",
		RequirePermission("mcp-server:read")(http.HandlerFunc(handleGetMCPServer(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/mcp-servers/{id}",
		RequirePermission("mcp-server:write")(http.HandlerFunc(handleUpdateMCPServer(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/mcp-servers/{id}",
		RequirePermission("mcp-server:delete")(http.HandlerFunc(handleDeleteMCPServer(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/mcp-servers/{id}/test",
		RequirePermission("mcp-server:read")(http.HandlerFunc(handleTestMCPServer(st))))

	// Tools
	mux.Handle("GET /api/v1/t/{tenant}/ai/tools",
		RequirePermission("ai-tool:read")(http.HandlerFunc(handleListAITools(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/tools",
		RequirePermission("ai-tool:write")(http.HandlerFunc(handleCreateAITool(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/tools/{id}",
		RequirePermission("ai-tool:read")(http.HandlerFunc(handleGetAITool(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/tools/{id}",
		RequirePermission("ai-tool:write")(http.HandlerFunc(handleUpdateAITool(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/tools/{id}",
		RequirePermission("ai-tool:delete")(http.HandlerFunc(handleDeleteAITool(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/tools/{id}/test",
		RequirePermission("ai-tool:write")(http.HandlerFunc(handleTestAITool(st))))

	// Agents
	mux.Handle("GET /api/v1/t/{tenant}/ai/agents",
		RequirePermission("ai-agent:read")(http.HandlerFunc(handleListAIAgents(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/agents",
		RequirePermission("ai-agent:write")(http.HandlerFunc(handleCreateAIAgent(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/agents/{id}",
		RequirePermission("ai-agent:read")(http.HandlerFunc(handleGetAIAgent(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/agents/{id}",
		RequirePermission("ai-agent:write")(http.HandlerFunc(handleUpdateAIAgent(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/agents/{id}",
		RequirePermission("ai-agent:delete")(http.HandlerFunc(handleDeleteAIAgent(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/agents/{id}/tools",
		RequirePermission("ai-agent:read")(http.HandlerFunc(handleListAgentBindings(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/agents/{id}/traces",
		RequirePermission("ai-trace:read")(http.HandlerFunc(handleListAgentTraces(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/agents/{id}/rotate-credential",
		RequirePermission("ai-agent:write")(http.HandlerFunc(handleRotateAgentCredential(st))))

	// Tool bindings
	mux.Handle("GET /api/v1/t/{tenant}/ai/tool-bindings",
		RequirePermission("ai-tool:read")(http.HandlerFunc(handleListAIToolBindings(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/tool-bindings",
		RequirePermission("ai-tool:write")(http.HandlerFunc(handleCreateAIToolBinding(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/tool-bindings/{id}",
		RequirePermission("ai-tool:read")(http.HandlerFunc(handleGetAIToolBinding(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/tool-bindings/{id}",
		RequirePermission("ai-tool:write")(http.HandlerFunc(handleUpdateAIToolBinding(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/tool-bindings/{id}",
		RequirePermission("ai-tool:delete")(http.HandlerFunc(handleDeleteAIToolBinding(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/tool-bindings/bulk-attach",
		RequirePermission("ai-tool:write")(http.HandlerFunc(handleBulkAttachBindings(st))))

	// Rate limits
	mux.Handle("GET /api/v1/t/{tenant}/ai/rate-limits",
		RequirePermission("ai-rate-limit:read")(http.HandlerFunc(handleListAIRateLimits(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/rate-limits",
		RequirePermission("ai-rate-limit:write")(http.HandlerFunc(handleCreateAIRateLimit(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/rate-limits/{id}",
		RequirePermission("ai-rate-limit:read")(http.HandlerFunc(handleGetAIRateLimit(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/rate-limits/{id}",
		RequirePermission("ai-rate-limit:write")(http.HandlerFunc(handleUpdateAIRateLimit(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/rate-limits/{id}",
		RequirePermission("ai-rate-limit:write")(http.HandlerFunc(handleDeleteAIRateLimit(st))))

	// Traces (read-only API; writes happen from the daemon's invoke path)
	mux.Handle("GET /api/v1/t/{tenant}/ai/traces",
		RequirePermission("ai-trace:read")(http.HandlerFunc(handleListAITraces(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/traces/{id}",
		RequirePermission("ai-trace:read")(http.HandlerFunc(handleGetAITrace(st))))
}

// ─── Provider handlers ──────────────────────────────────────────────────────

type aiProviderResponse struct {
	ID        string          `json:"id"`
	TenantID  string          `json:"tenantId"`
	Name      string          `json:"name"`
	Kind      string          `json:"kind"`
	BaseURL   string          `json:"baseUrl"`
	Enabled   bool            `json:"enabled"`
	Metadata  json.RawMessage `json:"metadata"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	// Credential intentionally omitted from list/detail; only tested via /test endpoint.
}

func aiProviderToResponse(p *store.AIProvider) aiProviderResponse {
	return aiProviderResponse{
		ID:        p.ID,
		TenantID:  p.TenantID,
		Name:      p.Name,
		Kind:      p.Kind,
		BaseURL:   p.BaseURL,
		Enabled:   p.Enabled,
		Metadata:  rawOrEmpty(p.Metadata, "{}"),
		CreatedAt: p.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: p.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleListAIProviders(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAIProvidersByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list ai_providers")
			return
		}
		out := make([]aiProviderResponse, 0, len(items))
		for _, p := range items {
			out = append(out, aiProviderToResponse(p))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateAIProvider(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req struct {
			Name       string          `json:"name"`
			Kind       string          `json:"kind"`
			BaseURL    string          `json:"baseUrl,omitempty"`
			Credential *string         `json:"credential,omitempty"`
			Enabled    bool            `json:"enabled"`
			Metadata   json.RawMessage `json:"metadata,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" || req.Kind == "" {
			writeBadRequest(w, r, "name and kind are required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateAIProvider(r.Context(), &store.AIProvider{
			TenantID: tenant.ID, Name: req.Name, Kind: req.Kind, BaseURL: req.BaseURL,
			Credential: req.Credential, Enabled: true, Metadata: string(req.Metadata),
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIProviderNameTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"A provider with that name already exists in this tenant", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create ai_provider")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, aiProviderToResponse(created))
	}
}

func handleGetAIProvider(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		p, err := tx.GetAIProvider(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAIProviderNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
					"No provider with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get ai_provider")
			return
		}
		writeJSON(w, http.StatusOK, aiProviderToResponse(p))
	}
}

func handleUpdateAIProvider(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		var req struct {
			Name       *string          `json:"name,omitempty"`
			Kind       *string          `json:"kind,omitempty"`
			BaseURL    *string          `json:"baseUrl,omitempty"`
			Credential *string          `json:"credential,omitempty"`
			Enabled    *bool            `json:"enabled,omitempty"`
			Metadata   *json.RawMessage `json:"metadata,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		params := store.UpdateAIProviderParams{
			Name: req.Name, Kind: req.Kind, BaseURL: req.BaseURL, Credential: req.Credential, Enabled: req.Enabled,
		}
		if req.Metadata != nil {
			s := string(*req.Metadata)
			params.Metadata = &s
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateAIProvider(r.Context(), tenant.ID, id, params)
		if err != nil {
			_ = tx.Rollback()
			switch {
			case errors.Is(err, store.ErrAIProviderNotFound):
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
					"No provider with id "+id, r.URL.Path, nil)
			case errors.Is(err, store.ErrAIProviderNameTaken):
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"Another provider already uses that name", r.URL.Path, nil)
			default:
				writeInternalError(w, r, "update ai_provider")
			}
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, aiProviderToResponse(updated))
	}
}

func handleDeleteAIProvider(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteAIProvider(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIProviderNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
					"No provider with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete ai_provider")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleTestAIProvider is a placeholder — real implementation calls
// out to the upstream provider with a tiny prompt and reports the
// observed latency / status. For now it just verifies the row exists.
func handleTestAIProvider(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		p, err := tx.GetAIProvider(r.Context(), tenant.ID, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
				"No provider with id "+id, r.URL.Path, nil)
			return
		}
		// Stage-2 stub: always returns ok=true. Real check lands with
		// the LLM proxy work (#101).
		writeJSON(w, http.StatusOK, map[string]any{
			"providerId": p.ID,
			"ok":         true,
			"note":       "live connectivity check is stubbed in stage-2; lands with #101",
		})
	}
}

// ─── Provider model handlers ────────────────────────────────────────────────

type providerModelResponse struct {
	ID               string `json:"id"`
	ProviderID       string `json:"providerId"`
	UpstreamModelID  string `json:"upstreamModelId"`
	Alias            string `json:"alias"`
	RateLimitRPM     int32  `json:"rateLimitRpm"`
	DailyQuotaTokens int64  `json:"dailyQuotaTokens"`
	Enabled          bool   `json:"enabled"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

func providerModelToResponse(m *store.AIProviderModel) providerModelResponse {
	return providerModelResponse{
		ID: m.ID, ProviderID: m.ProviderID, UpstreamModelID: m.UpstreamModelID, Alias: m.Alias,
		RateLimitRPM: m.RateLimitRPM, DailyQuotaTokens: m.DailyQuotaTokens, Enabled: m.Enabled,
		CreatedAt: m.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: m.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func handleAddProviderModel(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		providerID := r.PathValue("id")
		var req struct {
			UpstreamModelID  string `json:"upstreamModelId"`
			Alias            string `json:"alias"`
			RateLimitRPM     int32  `json:"rateLimitRpm,omitempty"`
			DailyQuotaTokens int64  `json:"dailyQuotaTokens,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.UpstreamModelID == "" || req.Alias == "" {
			writeBadRequest(w, r, "upstreamModelId and alias are required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		// Cross-tenant guard: confirm provider belongs to this tenant.
		if _, err := tx.GetAIProvider(r.Context(), tenant.ID, providerID); err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
				"No provider with id "+providerID, r.URL.Path, nil)
			return
		}
		created, err := tx.AddProviderModel(r.Context(), &store.AIProviderModel{
			ProviderID: providerID, UpstreamModelID: req.UpstreamModelID, Alias: req.Alias,
			RateLimitRPM: req.RateLimitRPM, DailyQuotaTokens: req.DailyQuotaTokens, Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "add model")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, providerModelToResponse(created))
	}
}

func handleUpdateProviderModel(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		providerID := r.PathValue("id")
		modelID := r.PathValue("modelId")
		var req struct {
			Alias            *string `json:"alias,omitempty"`
			RateLimitRPM     *int32  `json:"rateLimitRpm,omitempty"`
			DailyQuotaTokens *int64  `json:"dailyQuotaTokens,omitempty"`
			Enabled          *bool   `json:"enabled,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if _, err := tx.GetAIProvider(r.Context(), tenant.ID, providerID); err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
				"No provider with id "+providerID, r.URL.Path, nil)
			return
		}
		updated, err := tx.UpdateProviderModel(r.Context(), providerID, modelID, store.UpdateAIProviderModelParams{
			Alias: req.Alias, RateLimitRPM: req.RateLimitRPM, DailyQuotaTokens: req.DailyQuotaTokens, Enabled: req.Enabled,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIProviderModelNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Model not found",
					"No model with id "+modelID, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update model")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, providerModelToResponse(updated))
	}
}

func handleRemoveProviderModel(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		providerID := r.PathValue("id")
		modelID := r.PathValue("modelId")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if _, err := tx.GetAIProvider(r.Context(), tenant.ID, providerID); err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Provider not found",
				"No provider with id "+providerID, r.URL.Path, nil)
			return
		}
		if err := tx.RemoveProviderModel(r.Context(), providerID, modelID); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIProviderModelNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Model not found",
					"No model with id "+modelID, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "remove model")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ─── MCP servers, Tools, Agents, Tool bindings, Rate limits, Traces ─────────
// (Compact CRUD — same shape as Provider above.)

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

func handleListAITools(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAIToolsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list ai_tools")
			return
		}
		out := make([]aiToolResponse, 0, len(items))
		for _, x := range items {
			out = append(out, aiToolToResponse(x))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateAITool(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
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
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" || req.Kind == "" {
			writeBadRequest(w, r, "name and kind are required")
			return
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
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"A tool with that name already exists in this tenant", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create ai_tool")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, aiToolToResponse(created))
	}
}

func handleGetAITool(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		x, err := tx.GetAITool(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAIToolNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Tool not found",
					"No tool with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get ai_tool")
			return
		}
		writeJSON(w, http.StatusOK, aiToolToResponse(x))
	}
}

func handleUpdateAITool(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
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
			writeBadRequest(w, r, "invalid JSON body")
			return
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
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Tool not found",
					"No tool with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update ai_tool")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, aiToolToResponse(updated))
	}
}

func handleDeleteAITool(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteAITool(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIToolNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Tool not found",
					"No tool with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete ai_tool")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleTestAITool(st store.Driver) http.HandlerFunc {
	// Stub — actual invocation lands with #103.
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"toolId": r.PathValue("id"), "ok": true,
			"note": "live tool invocation is stubbed in stage-2",
		})
	}
}

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
		writeJSON(w, http.StatusOK, map[string]any{
			"agentId": r.PathValue("id"), "ok": true,
			"note": "scoped credential rotation is stubbed in stage-2",
		})
	}
}

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

func handleListAIRateLimits(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAIRateLimitsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list rate_limits")
			return
		}
		out := make([]aiRateLimitResponse, 0, len(items))
		for _, rl := range items {
			out = append(out, aiRateLimitToResponse(rl))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateAIRateLimit(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
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
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" || req.Scope == "" {
			writeBadRequest(w, r, "name and scope are required")
			return
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
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"A rate limit with that name already exists in this tenant", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create rate_limit")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, aiRateLimitToResponse(created))
	}
}

func handleGetAIRateLimit(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		rl, err := tx.GetAIRateLimit(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAIRateLimitNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Rate limit not found",
					"No rate_limit with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get rate_limit")
			return
		}
		writeJSON(w, http.StatusOK, aiRateLimitToResponse(rl))
	}
}

func handleUpdateAIRateLimit(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
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
			writeBadRequest(w, r, "invalid JSON body")
			return
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
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Rate limit not found",
					"No rate_limit with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update rate_limit")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, aiRateLimitToResponse(updated))
	}
}

func handleDeleteAIRateLimit(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteAIRateLimit(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrAIRateLimitNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Rate limit not found",
					"No rate_limit with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete rate_limit")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

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

func handleListAITraces(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListAITracesByTenant(r.Context(), tenant.ID, traceQueryFromRequest(r))
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

func handleGetAITrace(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		tr, err := tx.GetAITrace(r.Context(), tenant.ID, id)
		if err != nil {
			if errors.Is(err, store.ErrAITraceNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Trace not found",
					"No trace with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get trace")
			return
		}
		// TODO: gate sensitive fields on ai-trace:read-sensitive permission once
		// the permission catalog supports it; for now, include them.
		writeJSON(w, http.StatusOK, aiTraceToResponse(tr, true))
	}
}
