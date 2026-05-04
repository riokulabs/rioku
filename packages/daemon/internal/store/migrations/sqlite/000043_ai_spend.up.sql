-- Sprint 5 Phase 1e + 1f (#166, D8): AI spend log + daily rollups.
--
-- ai_spend_logs: one row per AI request, retained 7 days by
-- default (configurable per tenant). Columns track every metric
-- the cost calculator + admin debug surface need; messages +
-- response are nullable + opt-in per D8.
--
-- ai_spend_rollups: aggregated (tenant, virtual_key, model, date)
-- totals. Indefinite retention. Populated nightly from the spend
-- log via tx.AggregateAISpend; the UNIQUE constraint makes the
-- aggregator idempotent across re-runs.
CREATE TABLE ai_spend_logs (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    virtual_key_id      TEXT,
    application_id      TEXT REFERENCES applications(id) ON DELETE SET NULL,
    plan_id             TEXT REFERENCES plans(id) ON DELETE SET NULL,
    provider_id         TEXT,
    model_id            TEXT NOT NULL,
    estimated_tokens    INTEGER NOT NULL DEFAULT 0,
    input_tokens        INTEGER NOT NULL DEFAULT 0,
    output_tokens       INTEGER NOT NULL DEFAULT 0,
    cache_create_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
    total_tokens        INTEGER NOT NULL DEFAULT 0,
    cost_usd            REAL    NOT NULL DEFAULT 0,
    latency_ms          INTEGER NOT NULL DEFAULT 0,
    status              TEXT    NOT NULL DEFAULT 'ok',
    request_id          TEXT    NOT NULL DEFAULT '',
    messages            TEXT,
    response            TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_ai_spend_logs_tenant_time ON ai_spend_logs (tenant_id, created_at DESC);
CREATE INDEX idx_ai_spend_logs_key         ON ai_spend_logs (virtual_key_id);
CREATE INDEX idx_ai_spend_logs_model       ON ai_spend_logs (model_id);

CREATE TABLE ai_spend_rollups (
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    virtual_key_id      TEXT NOT NULL,
    model_id            TEXT NOT NULL,
    rollup_date         TEXT NOT NULL,
    request_count       INTEGER NOT NULL DEFAULT 0,
    error_count         INTEGER NOT NULL DEFAULT 0,
    input_tokens_total  INTEGER NOT NULL DEFAULT 0,
    output_tokens_total INTEGER NOT NULL DEFAULT 0,
    total_tokens        INTEGER NOT NULL DEFAULT 0,
    cost_usd_total      REAL    NOT NULL DEFAULT 0,
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (tenant_id, virtual_key_id, model_id, rollup_date)
);
CREATE INDEX idx_ai_spend_rollups_date ON ai_spend_rollups (rollup_date);
