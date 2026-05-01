-- 000001_initial.up.sql
-- Initial schema for the Rioku API Gateway config store (Postgres).

--------------------------------------------------------------------------------
-- Core: services
--------------------------------------------------------------------------------
CREATE TABLE services (
    id         TEXT PRIMARY KEY,                                          -- UUID
    name       TEXT NOT NULL UNIQUE,
    lb_policy  INTEGER NOT NULL DEFAULT 1,                               -- LoadBalancingPolicy enum (1 = ROUND_ROBIN)
    health_check TEXT,                                                   -- JSON HealthCheck object, nullable
    labels     TEXT DEFAULT '{}',                                        -- JSON object
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_services_name ON services (name);

--------------------------------------------------------------------------------
-- Core: routes
--------------------------------------------------------------------------------
CREATE TABLE routes (
    id                TEXT PRIMARY KEY,                                   -- UUID
    name              TEXT NOT NULL UNIQUE,
    matchers          TEXT NOT NULL,                                      -- JSON array of Matcher objects
    target_service_id TEXT REFERENCES services(id) ON DELETE SET NULL,    -- FK, nullable
    target_upstream   TEXT,                                               -- JSON DirectUpstream object, nullable
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,                      -- boolean
    labels            TEXT DEFAULT '{}',                                  -- JSON object
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Exactly one of target_service_id or target_upstream must be non-null.
    CHECK (
        (target_service_id IS NOT NULL AND target_upstream IS NULL)
        OR
        (target_service_id IS NULL AND target_upstream IS NOT NULL)
    )
);

CREATE INDEX idx_routes_name    ON routes (name);
CREATE INDEX idx_routes_enabled ON routes (enabled);

--------------------------------------------------------------------------------
-- Core: upstreams (targets belonging to a service)
--------------------------------------------------------------------------------
CREATE TABLE upstreams (
    id         TEXT PRIMARY KEY,                                          -- UUID
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    address    TEXT NOT NULL,
    weight     INTEGER NOT NULL DEFAULT 1,
    tls_mode   INTEGER NOT NULL DEFAULT 0,                               -- TLSMode enum
    healthy    BOOLEAN NOT NULL DEFAULT TRUE,                            -- boolean
    dial_err   TEXT DEFAULT ''
);

CREATE INDEX idx_upstreams_service_id ON upstreams (service_id);

--------------------------------------------------------------------------------
-- Core: policies (rate limit, auth, transform, etc.)
--------------------------------------------------------------------------------
CREATE TABLE policies (
    id         TEXT PRIMARY KEY,                                          -- UUID
    name       TEXT NOT NULL UNIQUE,
    type       INTEGER NOT NULL,                                         -- PolicyType enum
    config     TEXT NOT NULL DEFAULT '{}',                               -- JSON policy-specific configuration
    labels     TEXT DEFAULT '{}',                                        -- JSON object
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_policies_name ON policies (name);
CREATE INDEX idx_policies_type ON policies (type);

--------------------------------------------------------------------------------
-- Core: policy_bindings (many-to-many between policies and routes/services)
--------------------------------------------------------------------------------
CREATE TABLE policy_bindings (
    policy_id   TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('route', 'service')),
    target_id   TEXT NOT NULL,

    PRIMARY KEY (policy_id, target_type, target_id)
);

CREATE INDEX idx_policy_bindings_target ON policy_bindings (target_type, target_id);

--------------------------------------------------------------------------------
-- Identity: api_keys
--------------------------------------------------------------------------------
CREATE TABLE api_keys (
    id         TEXT PRIMARY KEY,                                          -- UUID
    name       TEXT NOT NULL,
    key_hash   TEXT NOT NULL UNIQUE,
    scopes     TEXT NOT NULL DEFAULT '[]',                               -- JSON array of scope strings
    expires_at TIMESTAMPTZ,                                              -- nullable = no expiry
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ                                               -- nullable = not revoked
);

CREATE INDEX idx_api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_name     ON api_keys (name);

--------------------------------------------------------------------------------
-- Ops: config_versions (full config snapshots for rollback)
--------------------------------------------------------------------------------
CREATE TABLE config_versions (
    version    BIGSERIAL PRIMARY KEY,
    snapshot   TEXT NOT NULL,                                             -- JSON-encoded ConfigSnapshot
    actor      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--------------------------------------------------------------------------------
-- Ops: audit_log (append-only mutation log)
--------------------------------------------------------------------------------
CREATE TABLE audit_log (
    id             TEXT PRIMARY KEY,                                      -- UUID
    actor          TEXT NOT NULL,
    entity_type    TEXT NOT NULL,
    entity_id      TEXT NOT NULL,
    operation      TEXT NOT NULL,
    diff           TEXT DEFAULT '{}',                                    -- JSON
    config_version INTEGER NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity      ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_actor       ON audit_log (actor);
CREATE INDEX idx_audit_log_occurred_at ON audit_log (occurred_at);

--------------------------------------------------------------------------------
-- Migrations: schema_versions (created by driver, but include IF NOT EXISTS for safety)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_versions (
    version    INTEGER PRIMARY KEY,
    dirty      BOOLEAN NOT NULL DEFAULT FALSE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_versions (version, dirty) VALUES (1, FALSE)
    ON CONFLICT (version) DO NOTHING;
