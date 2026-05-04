-- Sprint 4 Phase 1a (#164): Subscriptions table.
-- MySQL doesn't support partial indexes. The "one live subscription
-- per (application, plan)" invariant is enforced at the application
-- layer (CreateSubscription pre-checks). The non-unique composite
-- index supports the same lookup at query speed.
CREATE TABLE subscriptions (
    id              VARCHAR(255) PRIMARY KEY,
    tenant_id       VARCHAR(255) NOT NULL,
    plan_id         VARCHAR(255) NOT NULL,
    application_id  VARCHAR(255) NOT NULL,
    api_id          VARCHAR(255) NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    request_message TEXT NOT NULL,
    reason_message  TEXT NOT NULL,
    starting_at     TIMESTAMP NULL,
    ending_at       TIMESTAMP NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_subscriptions_tenant      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_subscriptions_plan        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
    CONSTRAINT fk_subscriptions_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);
CREATE INDEX idx_subscriptions_tenant      ON subscriptions (tenant_id);
CREATE INDEX idx_subscriptions_plan        ON subscriptions (plan_id);
CREATE INDEX idx_subscriptions_application ON subscriptions (application_id);
CREATE INDEX idx_subscriptions_api         ON subscriptions (api_id);
CREATE INDEX idx_subscriptions_status      ON subscriptions (status);
CREATE INDEX idx_subscriptions_app_plan    ON subscriptions (application_id, plan_id);
