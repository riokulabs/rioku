-- Sprint 4 Phase 1a (#164): Plans table.
-- MySQL doesn't honour CHECK constraints in older versions; the
-- application layer is the source of truth for the enum strings.
CREATE TABLE plans (
    id                    VARCHAR(255) PRIMARY KEY,
    tenant_id             VARCHAR(255) NOT NULL,
    api_id                VARCHAR(255) NOT NULL,
    name                  VARCHAR(255) NOT NULL,
    description           TEXT NOT NULL,
    security_type         VARCHAR(32) NOT NULL,
    validation            VARCHAR(16) NOT NULL DEFAULT 'auto',
    status                VARCHAR(16) NOT NULL DEFAULT 'staging',
    rate_limit_per_minute INT NOT NULL DEFAULT 0,
    quota_per_day         INT NOT NULL DEFAULT 0,
    selection_rule        TEXT NOT NULL,
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_plans_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_plans_tenant ON plans (tenant_id);
CREATE INDEX idx_plans_api    ON plans (api_id);
CREATE INDEX idx_plans_status ON plans (status);
CREATE UNIQUE INDEX idx_plans_tenant_name ON plans (tenant_id, name);
