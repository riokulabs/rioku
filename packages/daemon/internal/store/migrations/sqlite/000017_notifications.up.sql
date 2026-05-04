--------------------------------------------------------------------------------
-- Notifications subsystem (stage-2): 5 tables.
--
-- NotificationItem: per-user inbox entries (append-mostly, mutate
--   read_at / archived_at flags only).
-- NotificationChannel: outbound delivery destination (email, slack,
--   webhook, ...). Per-tenant.
-- NotificationRoutingRule: event -> channel mapping evaluated in
--   order_hint sequence.
-- NotificationDeliveryLogEntry: audit trail for each delivery attempt.
-- TenantNotificationConfig: singleton-per-tenant master switch +
--   retry policy.
--------------------------------------------------------------------------------

CREATE TABLE notification_items (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT REFERENCES tenants(id) ON DELETE CASCADE,           -- nullable: super-admin broadcasts
    user_id         TEXT NOT NULL,                                            -- recipient
    category        TEXT NOT NULL DEFAULT 'general',
    severity        TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','error','success')),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL DEFAULT '',
    action_link     TEXT,
    metadata        TEXT NOT NULL DEFAULT '{}',                               -- JSON
    read_at         TEXT,
    archived_at     TEXT,
    occurred_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_notif_items_tenant_user ON notification_items (tenant_id, user_id, occurred_at DESC);
CREATE INDEX idx_notif_items_unread      ON notification_items (user_id, read_at) WHERE read_at IS NULL;

CREATE TABLE notification_channels (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('email','slack','webhook','pagerduty','teams','sms')),
    config      TEXT NOT NULL DEFAULT '{}',                                   -- kind-specific JSON config
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);
CREATE INDEX idx_notif_channels_tenant ON notification_channels (tenant_id);

CREATE TABLE notification_routing_rules (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    event_filter  TEXT NOT NULL DEFAULT '{}',                                 -- JSON {category, severity, regex...}
    channel_ids   TEXT NOT NULL DEFAULT '[]',                                 -- JSON array of channel IDs
    enabled       INTEGER NOT NULL DEFAULT 1,
    order_hint    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);
CREATE INDEX idx_notif_rules_tenant ON notification_routing_rules (tenant_id, order_hint);

CREATE TABLE notification_delivery_log (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_id          TEXT REFERENCES notification_channels(id) ON DELETE SET NULL,
    notification_id     TEXT REFERENCES notification_items(id) ON DELETE SET NULL,
    status              TEXT NOT NULL CHECK (status IN ('delivered','retrying','failed','pending')),
    attempts            INTEGER NOT NULL DEFAULT 0,
    first_attempted_at  TEXT,
    last_attempted_at   TEXT,
    last_error          TEXT,
    metadata            TEXT NOT NULL DEFAULT '{}'                            -- JSON {response_code, response_body...}
);
CREATE INDEX idx_notif_log_tenant ON notification_delivery_log (tenant_id, last_attempted_at DESC);
CREATE INDEX idx_notif_log_channel ON notification_delivery_log (channel_id);

-- Singleton-per-tenant: master switch + retry policy.
CREATE TABLE tenant_notification_configs (
    tenant_id              TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    enabled                INTEGER NOT NULL DEFAULT 1,
    opt_in_mode            TEXT NOT NULL DEFAULT 'opt-in' CHECK (opt_in_mode IN ('opt-in','opt-out')),
    max_retries            INTEGER NOT NULL DEFAULT 3,
    retry_backoff_seconds  INTEGER NOT NULL DEFAULT 30,
    channel_priority       TEXT NOT NULL DEFAULT '[]',                        -- JSON ordered array of channel kinds
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
