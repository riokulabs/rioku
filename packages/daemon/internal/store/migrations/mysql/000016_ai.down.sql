DROP INDEX IF EXISTS idx_ai_traces_agent_time;
DROP INDEX IF EXISTS idx_ai_traces_tenant_time;
DROP TABLE IF EXISTS ai_traces;

DROP INDEX IF EXISTS idx_ai_rate_limits_tenant;
DROP TABLE IF EXISTS ai_semantic_rate_limits;

DROP INDEX IF EXISTS idx_ai_tool_bindings_tool;
DROP INDEX IF EXISTS idx_ai_tool_bindings_agent;
DROP INDEX IF EXISTS idx_ai_tool_bindings_tenant;
DROP TABLE IF EXISTS ai_tool_bindings;

DROP INDEX IF EXISTS idx_ai_agents_provider;
DROP INDEX IF EXISTS idx_ai_agents_tenant;
DROP TABLE IF EXISTS ai_agents;

DROP INDEX IF EXISTS idx_ai_tools_tenant;
DROP TABLE IF EXISTS ai_tools;

DROP INDEX IF EXISTS idx_ai_mcp_servers_tenant;
DROP TABLE IF EXISTS ai_mcp_servers;

DROP INDEX IF EXISTS idx_ai_provider_models_provider;
DROP TABLE IF EXISTS ai_provider_models;

DROP INDEX IF EXISTS idx_ai_providers_tenant;
DROP TABLE IF EXISTS ai_providers;

DELETE FROM schema_versions WHERE version = 16;
