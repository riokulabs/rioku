-- Sprint 4 Phase 1a (#164): Subscriptions table.
--
-- A Subscription is the (Application, Plan, API) tuple that authorises
-- an application to consume an API under a plan's terms. State machine:
-- pending → accepted | rejected → paused → closed.
--   - pending: subscription request awaiting approval (validation=manual).
--   - accepted: active; api_keys with this subscription_id resolve.
--   - rejected: terminal; tracked for audit; no resolution.
--   - paused: temporary suspension; api_keys return 403.
--   - closed: terminal; tracked for audit; no resolution.
--
-- request_message is the consumer's note when requesting; reason_message
-- is the approver's response (typically used on rejection or pause).
-- starting_at + ending_at bound the active window; NULL means open-ended.
CREATE TABLE subscriptions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    api_id          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'paused', 'closed')),
    request_message TEXT NOT NULL DEFAULT '',
    reason_message  TEXT NOT NULL DEFAULT '',
    starting_at     TEXT,
    ending_at       TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_subscriptions_tenant      ON subscriptions (tenant_id);
CREATE INDEX idx_subscriptions_plan        ON subscriptions (plan_id);
CREATE INDEX idx_subscriptions_application ON subscriptions (application_id);
CREATE INDEX idx_subscriptions_api         ON subscriptions (api_id);
CREATE INDEX idx_subscriptions_status      ON subscriptions (status);
-- One active (or pending) subscription per (application, plan) pair —
-- consumers can re-request after a closed/rejected one but can't have
-- two live subs to the same plan from the same app at once. Enforced
-- via partial-unique-index on the active states.
CREATE UNIQUE INDEX idx_subscriptions_app_plan_active
    ON subscriptions (application_id, plan_id)
    WHERE status IN ('pending', 'accepted', 'paused');
