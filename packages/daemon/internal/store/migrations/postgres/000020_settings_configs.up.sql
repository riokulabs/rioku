--------------------------------------------------------------------------------
-- Settings configs (stage-2): four singleton-per-tenant tables.
--
-- Each is keyed by tenant_id (no separate id PK) and represents a
-- single configuration document for that tenant. All four use the
-- same INSERT...ON CONFLICT DO UPDATE upsert pattern.
--------------------------------------------------------------------------------

CREATE TABLE network_configs (
    tenant_id              TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    listen_addresses       TEXT NOT NULL DEFAULT '[]',                       -- JSON array
    http3_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    caddy_config_overrides TEXT NOT NULL DEFAULT '{}',                       -- JSON
    read_timeout_seconds   INTEGER NOT NULL DEFAULT 60,
    write_timeout_seconds  INTEGER NOT NULL DEFAULT 60,
    idle_timeout_seconds   INTEGER NOT NULL DEFAULT 120,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tenant_auth_policies (
    tenant_id          TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    totp_policy        TEXT NOT NULL DEFAULT 'optional' CHECK (totp_policy IN ('all','admins','optional')),
    min_length         INTEGER NOT NULL DEFAULT 12,
    require_uppercase  BOOLEAN NOT NULL DEFAULT FALSE,
    require_lowercase  BOOLEAN NOT NULL DEFAULT FALSE,
    require_digit      BOOLEAN NOT NULL DEFAULT FALSE,
    require_symbol     BOOLEAN NOT NULL DEFAULT FALSE,
    idle_hours         INTEGER NOT NULL DEFAULT 24,
    absolute_hours     INTEGER NOT NULL DEFAULT 168,
    max_failed_attempts INTEGER NOT NULL DEFAULT 5,
    lockout_minutes     INTEGER NOT NULL DEFAULT 15,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE observability_configs (
    tenant_id              TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    metrics_scrape_endpoint TEXT NOT NULL DEFAULT '',
    metrics_scrape_auth     TEXT NOT NULL DEFAULT '{}',                      -- JSON {kind, credential}
    metrics_retention_days  INTEGER NOT NULL DEFAULT 30,
    log_levels              TEXT NOT NULL DEFAULT '{}',                      -- JSON {component: level}
    log_format              TEXT NOT NULL DEFAULT 'json' CHECK (log_format IN ('json','text')),
    log_rotation            TEXT NOT NULL DEFAULT '{}',                      -- JSON {max_size_mb, max_backups, max_age_days}
    traces_retention_days   INTEGER NOT NULL DEFAULT 7,
    traces_sample_rate      REAL NOT NULL DEFAULT 1.0,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_retention_configs (
    tenant_id                  TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    retention_days_read        INTEGER NOT NULL DEFAULT 30,
    retention_days_write       INTEGER NOT NULL DEFAULT 90,
    retention_days_destructive INTEGER NOT NULL DEFAULT 365,
    auto_export                TEXT NOT NULL DEFAULT 'never' CHECK (auto_export IN ('daily','weekly','monthly','never')),
    auto_export_format         TEXT NOT NULL DEFAULT 'jsonl' CHECK (auto_export_format IN ('csv','jsonl')),
    auto_export_destination    TEXT,                                         -- e.g. s3 bucket URL
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_versions (version, dirty) VALUES (20, FALSE)
    ON CONFLICT (version) DO NOTHING;
