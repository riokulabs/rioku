-- Sprint 5 Phase 4 (#181, D9): MCP gateway tables.
--
-- v1 auth model: API key -> mcp_team -> allow-list of (server, tool).
-- Per D9, agents are deferred to v3; this gives us a thin team
-- wrapper that v3 will extend without re-shaping the schema.
--
-- mcp_routes is a separate concern: the HTTP route in front of the
-- MCP gateway. It maps a Rioku route hostname/path to a backend
-- MCP server URL with auth-passthrough rules. Caddy compiles this
-- to a reverse_proxy handler.

CREATE TABLE mcp_teams (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_mcp_teams_tenant ON mcp_teams (tenant_id);
CREATE UNIQUE INDEX idx_mcp_teams_tenant_name ON mcp_teams (tenant_id, name);

-- Team-tool allow-list: which tools, on which MCP server, the team
-- is allowed to invoke. tool_name='*' permits every tool the
-- referenced server exposes (per D9). Composite uniqueness prevents
-- duplicate (team, server, tool) rows.
CREATE TABLE mcp_team_permissions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    team_id         TEXT NOT NULL REFERENCES mcp_teams(id) ON DELETE CASCADE,
    mcp_server_id   TEXT NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
    tool_name       TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_mcp_team_perms_team ON mcp_team_permissions (team_id);
CREATE INDEX idx_mcp_team_perms_server ON mcp_team_permissions (mcp_server_id);
CREATE UNIQUE INDEX idx_mcp_team_perms_unique
    ON mcp_team_permissions (team_id, mcp_server_id, tool_name);

-- api_keys gain an optional MCP team binding. NULL means the key
-- is not authorised for the MCP gateway (it's a regular API key).
ALTER TABLE api_keys ADD COLUMN mcp_team_id TEXT REFERENCES mcp_teams(id) ON DELETE SET NULL;
CREATE INDEX idx_api_keys_mcp_team ON api_keys (mcp_team_id);

-- mcp_routes: HTTP routing in front of an MCP server. The Caddy
-- compiler emits a reverse_proxy handler with the configured auth
-- passthrough rules.
CREATE TABLE mcp_routes (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    hostname          TEXT NOT NULL,
    path_prefix       TEXT NOT NULL DEFAULT '/',
    mcp_server_id     TEXT NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
    -- 'forward' passes the inbound Authorization header through to
    -- the MCP server unchanged. 'replace' rewrites it using the
    -- mcp_server's stored credential. 'strip' drops it (anonymous).
    auth_passthrough  TEXT NOT NULL DEFAULT 'forward'
        CHECK (auth_passthrough IN ('forward', 'replace', 'strip')),
    enabled           INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_mcp_routes_tenant ON mcp_routes (tenant_id);
CREATE UNIQUE INDEX idx_mcp_routes_hostname_path
    ON mcp_routes (tenant_id, hostname, path_prefix);
