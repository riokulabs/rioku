CREATE TABLE mcp_teams (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mcp_teams_tenant ON mcp_teams (tenant_id);
CREATE UNIQUE INDEX idx_mcp_teams_tenant_name ON mcp_teams (tenant_id, name);

CREATE TABLE mcp_team_permissions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    team_id         TEXT NOT NULL REFERENCES mcp_teams(id) ON DELETE CASCADE,
    mcp_server_id   TEXT NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
    tool_name       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mcp_team_perms_team ON mcp_team_permissions (team_id);
CREATE INDEX idx_mcp_team_perms_server ON mcp_team_permissions (mcp_server_id);
CREATE UNIQUE INDEX idx_mcp_team_perms_unique
    ON mcp_team_permissions (team_id, mcp_server_id, tool_name);

ALTER TABLE api_keys ADD COLUMN mcp_team_id TEXT REFERENCES mcp_teams(id) ON DELETE SET NULL;
CREATE INDEX idx_api_keys_mcp_team ON api_keys (mcp_team_id);

CREATE TABLE mcp_routes (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    hostname          TEXT NOT NULL,
    path_prefix       TEXT NOT NULL DEFAULT '/',
    mcp_server_id     TEXT NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
    auth_passthrough  TEXT NOT NULL DEFAULT 'forward'
        CHECK (auth_passthrough IN ('forward', 'replace', 'strip')),
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mcp_routes_tenant ON mcp_routes (tenant_id);
CREATE UNIQUE INDEX idx_mcp_routes_hostname_path
    ON mcp_routes (tenant_id, hostname, path_prefix);
