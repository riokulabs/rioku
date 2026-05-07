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
//
// Per-entity handlers live in sibling files (`ai_providers_routes.go`,
// `ai_mcp_routes.go`, `ai_tools_routes.go`, `ai_agents_routes.go`,
// `ai_tool_bindings_routes.go`, `ai_rate_limits_routes.go`,
// `ai_traces_routes.go`). This file only wires routes to handlers.
package gateway

import (
	"net/http"

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
	mux.Handle("POST /api/v1/t/{tenant}/ai/agents/{id}/invoke",
		RequirePermission("ai-agent:read")(http.HandlerFunc(handleInvokeAIAgent(st))))

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
	// Reveal: returns prompt/completion after appending an audit row.
	mux.Handle("POST /api/v1/t/{tenant}/ai/traces/{id}/reveal",
		RequirePermission("ai-trace:read-sensitive")(http.HandlerFunc(handleRevealAITrace(st))))
}
