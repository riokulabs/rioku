-- Sprint 4 Phase 1a (#164): Subscriptions table.
CREATE TABLE subscriptions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    api_id          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'paused', 'closed')),
    request_message TEXT NOT NULL DEFAULT '',
    reason_message  TEXT NOT NULL DEFAULT '',
    starting_at     TIMESTAMPTZ,
    ending_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subscriptions_tenant      ON subscriptions (tenant_id);
CREATE INDEX idx_subscriptions_plan        ON subscriptions (plan_id);
CREATE INDEX idx_subscriptions_application ON subscriptions (application_id);
CREATE INDEX idx_subscriptions_api         ON subscriptions (api_id);
CREATE INDEX idx_subscriptions_status      ON subscriptions (status);
-- Partial unique index: one live subscription per (application, plan)
-- across the active states.
CREATE UNIQUE INDEX idx_subscriptions_app_plan_active
    ON subscriptions (application_id, plan_id)
    WHERE status IN ('pending', 'accepted', 'paused');
