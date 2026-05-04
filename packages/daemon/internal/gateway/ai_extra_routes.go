// Package gateway: stage-2 admin completion chunk 9 — AI subsystem
// extras (PATCH, OPTIONS, action verbs, sub-collections, traces
// stream + CSV export).
//
// Many of the action endpoints here are currently stubs that record
// the intent and return 202/200 with documentation noting the deeper
// implementation lands when the corresponding subsystem ships
// (provider connectivity probes, agent invocation, rate-limit
// simulator, etc.). The endpoints exist now so the admin panel can
// wire its UI without 404s.
package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/gateway/export"
	"github.com/riokulabs/rioku/internal/gateway/links"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/gateway/stream"
	"github.com/riokulabs/rioku/internal/store"
)

func RegisterAIExtraRoutes(mux *http.ServeMux, st store.Driver) {
	// PATCH aliases for the entity update handlers (the existing PUT
	// handlers already accept partial bodies via pointer fields).
	mux.Handle("PATCH /api/v1/t/{tenant}/ai/providers/{id}",
		RequirePermission("ai:write")(http.HandlerFunc(handleUpdateAIProvider(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/ai/agents/{id}",
		RequirePermission("ai:write")(http.HandlerFunc(handleUpdateAIAgent(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/ai/tools/{id}",
		RequirePermission("ai:write")(http.HandlerFunc(handleUpdateAITool(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/ai/mcp-servers/{id}",
		RequirePermission("ai:write")(http.HandlerFunc(handleUpdateMCPServer(st))))

	// Sub-collections: relations from one entity to another.
	// /ai/agents/{id}/{tools,traces} are already registered in
	// ai_routes.go from PR #153. We add only the inverse relations.
	mux.Handle("GET /api/v1/t/{tenant}/ai/tools/{id}/agents",
		RequirePermission("ai:read")(http.HandlerFunc(handleListToolAgents(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/mcp-servers/{id}/tools",
		RequirePermission("ai:read")(http.HandlerFunc(handleListMCPServerTools(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/providers/{id}/agents",
		RequirePermission("ai:read")(http.HandlerFunc(handleListProviderAgents(st))))

	// Action stubs — all return 202/200 with the operator's intent
	// recorded. Deeper protocols ride alongside the corresponding
	// subsystem rollouts. handleListAgentTraces +
	// handleRotateAgentCredential already exist in ai_routes.go.
	mux.Handle("POST /api/v1/t/{tenant}/ai/tool-bindings/preview-condition",
		RequirePermission("ai:write")(http.HandlerFunc(handlePreviewToolBinding(st))))
	// /tool-bindings/bulk-attach already exists in ai_routes.go.
	mux.Handle("POST /api/v1/t/{tenant}/ai/rate-limits/{id}/simulate",
		RequirePermission("ai:read")(http.HandlerFunc(handleSimulateAIRateLimit(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/rate-limits/{id}/metrics",
		RequirePermission("ai:read")(http.HandlerFunc(handleAIRateLimitMetrics(st))))

	// Traces — stream (SSE) + CSV export.
	mux.Handle("GET /api/v1/t/{tenant}/ai/traces/stream",
		RequirePermission("ai:read")(http.HandlerFunc(handleAITracesStream(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/traces/export/csv",
		RequirePermission("ai:read")(http.HandlerFunc(handleAITracesExportCSV(st))))

	// OPTIONS coverage.
	for _, p := range []struct {
		path    string
		methods []string
	}{
		{"/api/v1/t/{tenant}/ai/providers", []string{"GET", "POST"}},
		{"/api/v1/t/{tenant}/ai/providers/{id}", []string{"GET", "PUT", "PATCH", "DELETE"}},
		{"/api/v1/t/{tenant}/ai/providers/{id}/test", []string{"POST"}},
		{"/api/v1/t/{tenant}/ai/providers/{id}/agents", []string{"GET"}},
		{"/api/v1/t/{tenant}/ai/providers/{id}/models", []string{"POST"}},
		{"/api/v1/t/{tenant}/ai/providers/{id}/models/{modelId}", []string{"PUT", "DELETE"}},
		{"/api/v1/t/{tenant}/ai/agents", []string{"GET", "POST"}},
		{"/api/v1/t/{tenant}/ai/agents/{id}", []string{"GET", "PUT", "PATCH", "DELETE"}},
		{"/api/v1/t/{tenant}/ai/agents/{id}/tools", []string{"GET"}},
		{"/api/v1/t/{tenant}/ai/agents/{id}/traces", []string{"GET"}},
		{"/api/v1/t/{tenant}/ai/agents/{id}/rotate-credential", []string{"POST"}},
		{"/api/v1/t/{tenant}/ai/tools", []string{"GET", "POST"}},
		{"/api/v1/t/{tenant}/ai/tools/{id}", []string{"GET", "PUT", "PATCH", "DELETE"}},
		{"/api/v1/t/{tenant}/ai/tools/{id}/test", []string{"POST"}},
		{"/api/v1/t/{tenant}/ai/tools/{id}/agents", []string{"GET"}},
		{"/api/v1/t/{tenant}/ai/mcp-servers", []string{"GET", "POST"}},
		{"/api/v1/t/{tenant}/ai/mcp-servers/{id}", []string{"GET", "PUT", "PATCH", "DELETE"}},
		{"/api/v1/t/{tenant}/ai/mcp-servers/{id}/test", []string{"POST"}},
		{"/api/v1/t/{tenant}/ai/mcp-servers/{id}/tools", []string{"GET"}},
		{"/api/v1/t/{tenant}/ai/tool-bindings/preview-condition", []string{"POST"}},
		{"/api/v1/t/{tenant}/ai/rate-limits/{id}/simulate", []string{"POST"}},
		{"/api/v1/t/{tenant}/ai/rate-limits/{id}/metrics", []string{"GET"}},
		{"/api/v1/t/{tenant}/ai/traces/stream", []string{"GET"}},
		{"/api/v1/t/{tenant}/ai/traces/export/csv", []string{"GET"}},
	} {
		optionsutil.Register(mux, p.path, p.methods)
	}
}

// ─── Sub-collections ────────────────────────────────────────────────────────

func handleListToolAgents(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		toolID := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		bindings, err := tx.ListAIToolBindingsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list bindings")
			return
		}
		b := links.NewTenantBuilder(tenant.Slug)
		items := make([]map[string]any, 0)
		for _, bd := range bindings {
			if bd.ToolID != toolID {
				continue
			}
			items = append(items, map[string]any{
				"agentId": bd.AgentID,
				"_links":  map[string]any{"agent": b.Self("ai/agents", bd.AgentID)},
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": items,
			"total": len(items),
		})
	}
}

func handleListMCPServerTools(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		mcpID := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		tools, err := tx.ListAIToolsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list tools")
			return
		}
		b := links.NewTenantBuilder(tenant.Slug)
		items := make([]map[string]any, 0)
		for _, t := range tools {
			if t.MCPServerID == nil || *t.MCPServerID != mcpID {
				continue
			}
			items = append(items, map[string]any{
				"id":     t.ID,
				"name":   t.Name,
				"_links": map[string]any{"tool": b.Self("ai/tools", t.ID)},
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
	}
}

func handleListProviderAgents(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		providerID := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		agents, err := tx.ListAIAgentsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list agents")
			return
		}
		b := links.NewTenantBuilder(tenant.Slug)
		items := make([]map[string]any, 0)
		for _, a := range agents {
			if a.ProviderID == nil || *a.ProviderID != providerID {
				continue
			}
			items = append(items, map[string]any{
				"id":     a.ID,
				"name":   a.Name,
				"_links": map[string]any{"agent": b.Self("ai/agents", a.ID)},
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
	}
}

// ─── Action stubs ───────────────────────────────────────────────────────────
//
// The real implementations land alongside the LLM proxy / tool-call
// router subsystems. For now these accept the operator's intent and
// return a placeholder result so the admin panel doesn't 404.

func handlePreviewToolBinding(_ store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Condition string         `json:"condition"`
			Envelope  map[string]any `json:"envelope"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		// Real CEL evaluation lands with the tool-call router. For
		// now we report the condition was received and assume "match"
		// when the condition is empty — empty condition = always-match.
		matched := req.Condition == ""
		writeJSON(w, http.StatusOK, map[string]any{
			"condition": req.Condition,
			"matched":   matched,
			"note":      "real CEL evaluation pending tool-call router rollout",
		})
	}
}

func handleSimulateAIRateLimit(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.GetAIRateLimit(r.Context(), tenant.ID, id); err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Rate limit not found", "No rate-limit with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"rateLimitId": id,
			"hits":        0,
			"window":      "1h",
			"note":        "simulator replays last-N traces once the trace-replay subsystem ships",
		})
	}
}

func handleAIRateLimitMetrics(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.GetAIRateLimit(r.Context(), tenant.ID, id); err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound,
				"Rate limit not found", "No rate-limit with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"rateLimitId":  id,
			"current":      0,
			"limit":        0,
			"resetSeconds": 3600,
			"note":         "Prometheus-shaped metrics emit once the LLM proxy is wired",
		})
	}
}

// handleAITracesStream pushes new AI traces over SSE. Backed by a 5s
// poll like the audit stream.
func handleAITracesStream(st store.Driver) http.HandlerFunc {
	s := stream.Stream[*store.AITrace]{
		EventName: "ai-trace",
		Encode: func(t *store.AITrace) (string, []byte, error) {
			payload := map[string]any{
				"id":           t.ID,
				"model":        t.Model,
				"status":       t.Status,
				"inputTokens":  t.InputTokens,
				"outputTokens": t.OutputTokens,
				"durationMs":   t.DurationMS,
				"occurredAt":   t.OccurredAt.UTC().Format(time.RFC3339Nano),
			}
			if t.AgentID != nil {
				payload["agentId"] = *t.AgentID
			}
			if t.ProviderID != nil {
				payload["providerId"] = *t.ProviderID
			}
			raw, err := json.Marshal(payload)
			return "", raw, err
		},
		Subscribe: func(ctx context.Context) (<-chan *store.AITrace, func(), error) {
			out := make(chan *store.AITrace, 32)
			done := make(chan struct{})
			lastSeen := time.Now().UTC()
			go func() {
				defer close(out)
				ticker := time.NewTicker(5 * time.Second)
				defer ticker.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case <-done:
						return
					case <-ticker.C:
					}
					tn := TenantFromContext(ctx)
					if tn == nil {
						continue
					}
					tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
					if err != nil {
						continue
					}
					traces, err := tx.ListAITracesByTenant(ctx, tn.ID, store.AITraceQuery{Since: &lastSeen, Limit: 200})
					_ = tx.Rollback()
					if err != nil {
						continue
					}
					for i := len(traces) - 1; i >= 0; i-- {
						tr := traces[i]
						ts := tr.OccurredAt
						if !ts.After(lastSeen) {
							continue
						}
						select {
						case out <- tr:
						case <-ctx.Done():
							return
						}
						lastSeen = ts
					}
				}
			}()
			return out, func() { close(done) }, nil
		},
	}
	return s.Handler()
}

func handleAITracesExportCSV(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		traces, err := tx.ListAITracesByTenant(r.Context(), tenant.ID, store.AITraceQuery{})
		if err != nil {
			writeInternalError(w, r, "list traces")
			return
		}
		rows := make([]map[string]any, 0, len(traces))
		for _, t := range traces {
			row := map[string]any{
				"id":           t.ID,
				"model":        t.Model,
				"status":       t.Status,
				"inputTokens":  t.InputTokens,
				"outputTokens": t.OutputTokens,
				"durationMs":   t.DurationMS,
				"occurredAt":   t.OccurredAt,
			}
			if t.AgentID != nil {
				row["agentId"] = *t.AgentID
			}
			if t.ProviderID != nil {
				row["providerId"] = *t.ProviderID
			}
			rows = append(rows, row)
		}
		_ = export.WriteCSV(w, r, "ai-traces.csv",
			[]string{"id", "occurredAt", "agentId", "providerId", "model", "status", "inputTokens", "outputTokens", "durationMs"},
			export.FromSlice(r.Context(), rows))
	}
}
