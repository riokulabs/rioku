-- Sprint 5 Phase 2 (#167): virtual keys.
CREATE TABLE virtual_keys (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    provider_id     TEXT NOT NULL,
    credential_ref  TEXT NOT NULL DEFAULT '',
    allowed_models  JSONB NOT NULL DEFAULT '[]'::jsonb,
    rpm_limit       INTEGER NOT NULL DEFAULT 0,
    tpm_limit       INTEGER NOT NULL DEFAULT 0,
    budget_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,
    budget_window   TEXT NOT NULL DEFAULT 'month' CHECK (budget_window IN ('minute', 'hour', 'day', 'month')),
    revoked_at      TIMESTAMPTZ,
    created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_virtual_keys_tenant   ON virtual_keys (tenant_id);
CREATE INDEX idx_virtual_keys_provider ON virtual_keys (provider_id);
CREATE UNIQUE INDEX idx_virtual_keys_tenant_name ON virtual_keys (tenant_id, name);
