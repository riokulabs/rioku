-- Sprint 5 Phase 1e + 1f (#166, D8): AI spend log + daily rollups.
CREATE TABLE ai_spend_logs (
    id                  VARCHAR(255) PRIMARY KEY,
    tenant_id           VARCHAR(255) NOT NULL,
    virtual_key_id      VARCHAR(255),
    application_id      VARCHAR(255),
    plan_id             VARCHAR(255),
    provider_id         VARCHAR(255),
    model_id            VARCHAR(255) NOT NULL,
    estimated_tokens    INT NOT NULL DEFAULT 0,
    input_tokens        INT NOT NULL DEFAULT 0,
    output_tokens       INT NOT NULL DEFAULT 0,
    cache_create_tokens INT NOT NULL DEFAULT 0,
    cache_read_tokens   INT NOT NULL DEFAULT 0,
    total_tokens        INT NOT NULL DEFAULT 0,
    cost_usd            DOUBLE NOT NULL DEFAULT 0,
    latency_ms          INT NOT NULL DEFAULT 0,
    status              VARCHAR(32) NOT NULL DEFAULT 'ok',
    request_id          VARCHAR(255) NOT NULL DEFAULT '',
    messages            LONGTEXT,
    response            LONGTEXT,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ai_spend_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_spend_logs_app    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_spend_logs_plan   FOREIGN KEY (plan_id)        REFERENCES plans(id)        ON DELETE SET NULL
);
CREATE INDEX idx_ai_spend_logs_tenant_time ON ai_spend_logs (tenant_id, created_at);
CREATE INDEX idx_ai_spend_logs_key         ON ai_spend_logs (virtual_key_id);
CREATE INDEX idx_ai_spend_logs_model       ON ai_spend_logs (model_id);

CREATE TABLE ai_spend_rollups (
    tenant_id           VARCHAR(255) NOT NULL,
    virtual_key_id      VARCHAR(255) NOT NULL,
    model_id            VARCHAR(255) NOT NULL,
    rollup_date         DATE NOT NULL,
    request_count       INT NOT NULL DEFAULT 0,
    error_count         INT NOT NULL DEFAULT 0,
    input_tokens_total  INT NOT NULL DEFAULT 0,
    output_tokens_total INT NOT NULL DEFAULT 0,
    total_tokens        INT NOT NULL DEFAULT 0,
    cost_usd_total      DOUBLE NOT NULL DEFAULT 0,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, virtual_key_id, model_id, rollup_date),
    CONSTRAINT fk_ai_spend_rollups_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_spend_rollups_date ON ai_spend_rollups (rollup_date);
