-- Sprint 4 Phase 2 (#171): per-route OpenAPI request validator config.
--
-- One row per route that has the rioku_oas_validator plugin enabled.
-- The plugin module already ships in bin/rioku-caddy from Sprint 4
-- Phase 2's plugin work; this table provides the storage admins
-- configure through the REST surface, and the daemon's compiler
-- reads when emitting per-route Caddy handler chains.
CREATE TABLE route_oas_configs (
    route_id                  TEXT PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
    tenant_id                 TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    oas_url                   TEXT NOT NULL DEFAULT '',
    oas_inline                TEXT NOT NULL DEFAULT '',
    refresh_interval_seconds  INTEGER NOT NULL DEFAULT 0,
    validate_request_body     INTEGER NOT NULL DEFAULT 1,
    validate_request_params   INTEGER NOT NULL DEFAULT 1,
    reject_unknown            INTEGER NOT NULL DEFAULT 0,
    created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_route_oas_configs_tenant ON route_oas_configs (tenant_id);
