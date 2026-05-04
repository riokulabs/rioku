-- Sprint 5 Phase 2 (#167): virtual keys.
--
-- A virtual key wraps an upstream AI provider's real credential
-- with Rioku-side policy: allowed_models filter, per-key
-- rpm/tpm/budget limits, attribution to a creator. The AI gateway
-- (D7) resolves the inbound API key → virtual key → upstream
-- credential at request time; the upstream credential is a vault
-- reference (D12) so plaintext never lands at rest.
--
-- budget_window: "minute" | "hour" | "day" | "month" — the time
-- bucket that budget_usd is tracked against. The AI gateway
-- decides whether to reject pre-call when cumulative spend in
-- the active window would exceed budget_usd.
CREATE TABLE virtual_keys (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    provider_id     TEXT NOT NULL,
    credential_ref  TEXT NOT NULL DEFAULT '',
    allowed_models  TEXT NOT NULL DEFAULT '[]',
    rpm_limit       INTEGER NOT NULL DEFAULT 0,
    tpm_limit       INTEGER NOT NULL DEFAULT 0,
    budget_usd      REAL    NOT NULL DEFAULT 0,
    budget_window   TEXT    NOT NULL DEFAULT 'month' CHECK (budget_window IN ('minute', 'hour', 'day', 'month')),
    revoked_at      TEXT,
    created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_virtual_keys_tenant   ON virtual_keys (tenant_id);
CREATE INDEX idx_virtual_keys_provider ON virtual_keys (provider_id);
CREATE UNIQUE INDEX idx_virtual_keys_tenant_name ON virtual_keys (tenant_id, name);
