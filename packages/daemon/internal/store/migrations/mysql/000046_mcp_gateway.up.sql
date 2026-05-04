CREATE TABLE mcp_teams (
    id            VARCHAR(64) PRIMARY KEY,
    tenant_id     VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    description   TEXT NOT NULL DEFAULT (''),
    status        VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
    created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX idx_mcp_teams_tenant ON mcp_teams (tenant_id);
CREATE UNIQUE INDEX idx_mcp_teams_tenant_name ON mcp_teams (tenant_id, name);

CREATE TABLE mcp_team_permissions (
    id              VARCHAR(64) PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    team_id         VARCHAR(64) NOT NULL REFERENCES mcp_teams(id) ON DELETE CASCADE,
    mcp_server_id   VARCHAR(64) NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
    tool_name       VARCHAR(255) NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX idx_mcp_team_perms_team ON mcp_team_permissions (team_id);
CREATE INDEX idx_mcp_team_perms_server ON mcp_team_permissions (mcp_server_id);
CREATE UNIQUE INDEX idx_mcp_team_perms_unique
    ON mcp_team_permissions (team_id, mcp_server_id, tool_name);

ALTER TABLE api_keys ADD COLUMN mcp_team_id VARCHAR(64) REFERENCES mcp_teams(id) ON DELETE SET NULL;
CREATE INDEX idx_api_keys_mcp_team ON api_keys (mcp_team_id);

CREATE TABLE mcp_routes (
    id                VARCHAR(64) PRIMARY KEY,
    tenant_id         VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              VARCHAR(255) NOT NULL,
    hostname          VARCHAR(255) NOT NULL,
    path_prefix       VARCHAR(255) NOT NULL DEFAULT ('/'),
    mcp_server_id     VARCHAR(64) NOT NULL REFERENCES ai_mcp_servers(id) ON DELETE CASCADE,
    auth_passthrough  VARCHAR(16) NOT NULL DEFAULT 'forward'
        CHECK (auth_passthrough IN ('forward', 'replace', 'strip')),
    enabled           TINYINT(1) NOT NULL DEFAULT 1,
    created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX idx_mcp_routes_tenant ON mcp_routes (tenant_id);
CREATE UNIQUE INDEX idx_mcp_routes_hostname_path
    ON mcp_routes (tenant_id, hostname, path_prefix);
