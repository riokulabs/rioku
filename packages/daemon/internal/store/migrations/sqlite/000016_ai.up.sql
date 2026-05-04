--------------------------------------------------------------------------------
-- AI subsystem (stage-2): 7 tables.
--
-- Provider -> Agent -> ToolBinding <- Tool -> McpServer
--                ^
--                +-- Trace (history)
--                +-- SemanticRateLimit (per-agent or per-tool)
--
-- Every entity is tenant-scoped. The Trace table is append-only (no
-- updates) and is the largest by row count — pagination is by
-- (occurred_at DESC, id DESC) covered by a composite index.
--------------------------------------------------------------------------------

CREATE TABLE ai_providers (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('openai','anthropic','gemini','ollama','custom')),
    base_url     TEXT NOT NULL DEFAULT '',
    credential   TEXT,                                                       -- encrypted/masked credential reference
    enabled      INTEGER NOT NULL DEFAULT 1,
    metadata     TEXT NOT NULL DEFAULT '{}',                                 -- arbitrary JSON
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);
CREATE INDEX idx_ai_providers_tenant ON ai_providers (tenant_id);

-- Provider <-> Model alias mapping (one provider exposes many models).
CREATE TABLE ai_provider_models (
    id                 TEXT PRIMARY KEY,
    provider_id        TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    upstream_model_id  TEXT NOT NULL,                                        -- e.g. "gpt-4-turbo"
    alias              TEXT NOT NULL,                                        -- friendly name shown in agents
    rate_limit_rpm     INTEGER NOT NULL DEFAULT 0,                           -- 0 = unlimited
    daily_quota_tokens INTEGER NOT NULL DEFAULT 0,
    enabled            INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (provider_id, upstream_model_id)
);
CREATE INDEX idx_ai_provider_models_provider ON ai_provider_models (provider_id);

CREATE TABLE ai_mcp_servers (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    url                   TEXT NOT NULL,
    auth_kind             TEXT NOT NULL DEFAULT 'none' CHECK (auth_kind IN ('none','bearer','api-key')),
    auth_credential       TEXT,
    health                TEXT NOT NULL DEFAULT 'disabled' CHECK (health IN ('healthy','degraded','unreachable','disabled')),
    enabled               INTEGER NOT NULL DEFAULT 1,
    authorized_agent_ids  TEXT NOT NULL DEFAULT '[]',
    last_checked_at       TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);
CREATE INDEX idx_ai_mcp_servers_tenant ON ai_mcp_servers (tenant_id);

CREATE TABLE ai_tools (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('native','mcp','http')),
    description     TEXT NOT NULL DEFAULT '',
    schema_json     TEXT NOT NULL DEFAULT '{}',                              -- JSON schema for arguments
    http_endpoint   TEXT,                                                    -- when kind='http'
    mcp_server_id   TEXT REFERENCES ai_mcp_servers(id) ON DELETE SET NULL,   -- when kind='mcp'
    dangerous       INTEGER NOT NULL DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);
CREATE INDEX idx_ai_tools_tenant ON ai_tools (tenant_id);

CREATE TABLE ai_agents (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider_id         TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    model               TEXT NOT NULL DEFAULT '',
    system_prompt       TEXT NOT NULL DEFAULT '',
    guardrails          TEXT NOT NULL DEFAULT '{}',                          -- JSON
    scoped_credential   TEXT,                                                -- per-agent override
    enabled             INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);
CREATE INDEX idx_ai_agents_tenant   ON ai_agents (tenant_id);
CREATE INDEX idx_ai_agents_provider ON ai_agents (provider_id);

CREATE TABLE ai_tool_bindings (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id    TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL REFERENCES ai_tools(id)  ON DELETE CASCADE,
    condition   TEXT NOT NULL DEFAULT '',                                    -- CEL expression
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (agent_id, tool_id)
);
CREATE INDEX idx_ai_tool_bindings_tenant ON ai_tool_bindings (tenant_id);
CREATE INDEX idx_ai_tool_bindings_agent  ON ai_tool_bindings (agent_id);
CREATE INDEX idx_ai_tool_bindings_tool   ON ai_tool_bindings (tool_id);

CREATE TABLE ai_semantic_rate_limits (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    scope                TEXT NOT NULL CHECK (scope IN ('tenant','agent','tool')),
    agent_id             TEXT REFERENCES ai_agents(id) ON DELETE CASCADE,    -- when scope='agent'
    tool_id              TEXT REFERENCES ai_tools(id)  ON DELETE CASCADE,    -- when scope='tool'
    exemplars            TEXT NOT NULL DEFAULT '[]',                         -- JSON array of seed prompts
    similarity_threshold REAL NOT NULL DEFAULT 0.85,
    window_seconds       INTEGER NOT NULL DEFAULT 60,
    threshold            INTEGER NOT NULL DEFAULT 10,
    action               TEXT NOT NULL DEFAULT 'block' CHECK (action IN ('block','degrade','log')),
    enabled              INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);
CREATE INDEX idx_ai_rate_limits_tenant ON ai_semantic_rate_limits (tenant_id);

-- Append-only trace table — large by row count, queried with
-- (occurred_at DESC, id DESC) covering index.
CREATE TABLE ai_traces (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id        TEXT REFERENCES ai_agents(id) ON DELETE SET NULL,
    provider_id     TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
    model           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL CHECK (status IN ('success','error','timeout')),
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    prompt          TEXT,                                                    -- sensitive — gated on read
    completion      TEXT,                                                    -- sensitive — gated on read
    tool_calls_json TEXT NOT NULL DEFAULT '[]',
    error           TEXT,
    occurred_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_ai_traces_tenant_time ON ai_traces (tenant_id, occurred_at DESC);
CREATE INDEX idx_ai_traces_agent_time  ON ai_traces (agent_id, occurred_at DESC);
