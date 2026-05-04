-- Sprint 4 Phase 2 (#171): per-route OpenAPI request validator config.
CREATE TABLE route_oas_configs (
    route_id                  TEXT PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
    tenant_id                 TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    oas_url                   TEXT NOT NULL DEFAULT '',
    oas_inline                TEXT NOT NULL DEFAULT '',
    refresh_interval_seconds  INTEGER NOT NULL DEFAULT 0,
    validate_request_body     BOOLEAN NOT NULL DEFAULT TRUE,
    validate_request_params   BOOLEAN NOT NULL DEFAULT TRUE,
    reject_unknown            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_route_oas_configs_tenant ON route_oas_configs (tenant_id);
