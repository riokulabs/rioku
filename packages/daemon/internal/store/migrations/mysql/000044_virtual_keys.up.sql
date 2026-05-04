-- Sprint 5 Phase 2 (#167): virtual keys.
CREATE TABLE virtual_keys (
    id              VARCHAR(255) PRIMARY KEY,
    tenant_id       VARCHAR(255) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    provider_id     VARCHAR(255) NOT NULL,
    credential_ref  TEXT NOT NULL,
    allowed_models  JSON NOT NULL,
    rpm_limit       INT NOT NULL DEFAULT 0,
    tpm_limit       INT NOT NULL DEFAULT 0,
    budget_usd      DOUBLE NOT NULL DEFAULT 0,
    budget_window   VARCHAR(16) NOT NULL DEFAULT 'month',
    revoked_at      TIMESTAMP NULL,
    created_by      VARCHAR(255),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_virtual_keys_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_virtual_keys_creator FOREIGN KEY (created_by) REFERENCES users(id)   ON DELETE SET NULL
);
CREATE INDEX idx_virtual_keys_tenant   ON virtual_keys (tenant_id);
CREATE INDEX idx_virtual_keys_provider ON virtual_keys (provider_id);
CREATE UNIQUE INDEX idx_virtual_keys_tenant_name ON virtual_keys (tenant_id, name);
