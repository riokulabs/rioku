-- Sprint 4 Phase 2 (#171): per-route OpenAPI request validator config.
CREATE TABLE route_oas_configs (
    route_id                  VARCHAR(255) PRIMARY KEY,
    tenant_id                 VARCHAR(255) NOT NULL,
    oas_url                   TEXT NOT NULL,
    oas_inline                LONGTEXT NOT NULL,
    refresh_interval_seconds  INT NOT NULL DEFAULT 0,
    validate_request_body     TINYINT(1) NOT NULL DEFAULT 1,
    validate_request_params   TINYINT(1) NOT NULL DEFAULT 1,
    reject_unknown            TINYINT(1) NOT NULL DEFAULT 0,
    created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_route_oas_route  FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
    CONSTRAINT fk_route_oas_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_route_oas_configs_tenant ON route_oas_configs (tenant_id);
