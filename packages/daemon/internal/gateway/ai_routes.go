// Package gateway: AI subsystem REST endpoints.
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

	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

func RegisterAIRoutes(mux *http.ServeMux, st store.Driver) {
	// Providers
	mux.Handle("GET /api/v1/t/{tenant}/ai/providers",
		RequirePermission("ai-provider:read")(rerr.H(handleListAIProviders(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/providers",
		RequirePermission("ai-provider:write")(rerr.H(handleCreateAIProvider(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/providers/{id}",
		RequirePermission("ai-provider:read")(rerr.H(handleGetAIProvider(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/providers/{id}",
		RequirePermission("ai-provider:write")(rerr.H(handleUpdateAIProvider(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/providers/{id}",
		RequirePermission("ai-provider:delete")(rerr.H(handleDeleteAIProvider(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/providers/{id}/test",
		RequirePermission("ai-provider:read")(rerr.H(handleTestAIProvider(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/providers/{id}/models",
		RequirePermission("ai-provider:write")(rerr.H(handleAddProviderModel(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/providers/{id}/models/{modelId}",
		RequirePermission("ai-provider:write")(rerr.H(handleUpdateProviderModel(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/providers/{id}/models/{modelId}",
		RequirePermission("ai-provider:write")(rerr.H(handleRemoveProviderModel(st))))

	// MCP servers
	mux.Handle("GET /api/v1/t/{tenant}/ai/mcp-servers",
		RequirePermission("mcp-server:read")(rerr.H(handleListMCPServers(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/mcp-servers",
		RequirePermission("mcp-server:write")(rerr.H(handleCreateMCPServer(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/mcp-servers/{id}",
		RequirePermission("mcp-server:read")(rerr.H(handleGetMCPServer(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/mcp-servers/{id}",
		RequirePermission("mcp-server:write")(rerr.H(handleUpdateMCPServer(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/mcp-servers/{id}",
		RequirePermission("mcp-server:delete")(rerr.H(handleDeleteMCPServer(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/mcp-servers/{id}/test",
		RequirePermission("mcp-server:read")(rerr.H(handleTestMCPServer(st))))

	// Tools
	mux.Handle("GET /api/v1/t/{tenant}/ai/tools",
		RequirePermission("ai-tool:read")(rerr.H(handleListAITools(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/tools",
		RequirePermission("ai-tool:write")(rerr.H(handleCreateAITool(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/tools/{id}",
		RequirePermission("ai-tool:read")(rerr.H(handleGetAITool(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/tools/{id}",
		RequirePermission("ai-tool:write")(rerr.H(handleUpdateAITool(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/tools/{id}",
		RequirePermission("ai-tool:delete")(rerr.H(handleDeleteAITool(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/tools/{id}/test",
		RequirePermission("ai-tool:write")(rerr.H(handleTestAITool(st))))

	// Agents
	mux.Handle("GET /api/v1/t/{tenant}/ai/agents",
		RequirePermission("ai-agent:read")(rerr.H(handleListAIAgents(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/agents",
		RequirePermission("ai-agent:write")(rerr.H(handleCreateAIAgent(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/agents/{id}",
		RequirePermission("ai-agent:read")(rerr.H(handleGetAIAgent(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/agents/{id}",
		RequirePermission("ai-agent:write")(rerr.H(handleUpdateAIAgent(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/agents/{id}",
		RequirePermission("ai-agent:delete")(rerr.H(handleDeleteAIAgent(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/agents/{id}/tools",
		RequirePermission("ai-agent:read")(rerr.H(handleListAgentBindings(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/agents/{id}/traces",
		RequirePermission("ai-trace:read")(rerr.H(handleListAgentTraces(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/agents/{id}/rotate-credential",
		RequirePermission("ai-agent:write")(rerr.H(handleRotateAgentCredential(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/agents/{id}/invoke",
		RequirePermission("ai-agent:read")(rerr.H(handleInvokeAIAgent(st))))

	// Tool bindings
	mux.Handle("GET /api/v1/t/{tenant}/ai/tool-bindings",
		RequirePermission("ai-tool:read")(rerr.H(handleListAIToolBindings(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/tool-bindings",
		RequirePermission("ai-tool:write")(rerr.H(handleCreateAIToolBinding(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/tool-bindings/{id}",
		RequirePermission("ai-tool:read")(rerr.H(handleGetAIToolBinding(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/tool-bindings/{id}",
		RequirePermission("ai-tool:write")(rerr.H(handleUpdateAIToolBinding(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/tool-bindings/{id}",
		RequirePermission("ai-tool:delete")(rerr.H(handleDeleteAIToolBinding(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/tool-bindings/bulk-attach",
		RequirePermission("ai-tool:write")(rerr.H(handleBulkAttachBindings(st))))

	// Rate limits
	mux.Handle("GET /api/v1/t/{tenant}/ai/rate-limits",
		RequirePermission("ai-rate-limit:read")(rerr.H(handleListAIRateLimits(st))))
	mux.Handle("POST /api/v1/t/{tenant}/ai/rate-limits",
		RequirePermission("ai-rate-limit:write")(rerr.H(handleCreateAIRateLimit(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/rate-limits/{id}",
		RequirePermission("ai-rate-limit:read")(rerr.H(handleGetAIRateLimit(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/ai/rate-limits/{id}",
		RequirePermission("ai-rate-limit:write")(rerr.H(handleUpdateAIRateLimit(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/ai/rate-limits/{id}",
		RequirePermission("ai-rate-limit:write")(rerr.H(handleDeleteAIRateLimit(st))))

	// Traces (read-only API; writes happen from the daemon's invoke path)
	mux.Handle("GET /api/v1/t/{tenant}/ai/traces",
		RequirePermission("ai-trace:read")(rerr.H(handleListAITraces(st))))
	mux.Handle("GET /api/v1/t/{tenant}/ai/traces/{id}",
		RequirePermission("ai-trace:read")(rerr.H(handleGetAITrace(st))))
	// Reveal: returns prompt/completion after appending an audit row.
	mux.Handle("POST /api/v1/t/{tenant}/ai/traces/{id}/reveal",
		RequirePermission("ai-trace:read-sensitive")(rerr.H(handleRevealAITrace(st))))
}
