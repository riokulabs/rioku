// Package gateway: AI provider + provider-model handlers (stage-2).
//
// See `ai_routes.go` for the full route registration table.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/store"
)

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
