-- 000001_initial.up.sql
-- Initial schema for the Rioku API Gateway config store (MySQL).

-- --------------------------------------------------------------------------------
-- Core: services
-- --------------------------------------------------------------------------------
CREATE TABLE services (
    id         VARCHAR(64) PRIMARY KEY,                                       -- UUID
    name       TEXT NOT NULL UNIQUE,
    lb_policy  INTEGER NOT NULL DEFAULT 1,                                    -- LoadBalancingPolicy enum (1 = ROUND_ROBIN)
    health_check TEXT,                                                        -- JSON HealthCheck object, nullable
    labels     TEXT,                                             -- JSON object
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT ck_services_created_at CHECK (created_at IS NOT NULL),
    CONSTRAINT ck_services_updated_at CHECK (updated_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_services_name ON services (name);

-- --------------------------------------------------------------------------------
-- Core: routes
-- --------------------------------------------------------------------------------
CREATE TABLE routes (
    id                VARCHAR(64) PRIMARY KEY,                                -- UUID
    name              TEXT NOT NULL UNIQUE,
    matchers          TEXT NOT NULL,                                          -- JSON array of Matcher objects
    target_service_id VARCHAR(64) REFERENCES services(id) ON DELETE SET NULL, -- FK, nullable
    target_upstream   TEXT,                                                   -- JSON DirectUpstream object, nullable
    enabled           TINYINT(1) NOT NULL DEFAULT 1,                          -- boolean 0/1
    labels            TEXT,                                      -- JSON object
    created_at        DATETIME(6) NOT NULL,
    updated_at        DATETIME(6) NOT NULL,

    -- Exactly one of target_service_id or target_upstream must be non-null.
    CHECK (
        (target_service_id IS NOT NULL AND target_upstream IS NULL)
        OR
        (target_service_id IS NULL AND target_upstream IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_routes_name    ON routes (name);
CREATE INDEX idx_routes_enabled ON routes (enabled);

-- --------------------------------------------------------------------------------
-- Core: upstreams (targets belonging to a service)
-- --------------------------------------------------------------------------------
CREATE TABLE upstreams (
    id         VARCHAR(64) PRIMARY KEY,                                       -- UUID
    service_id VARCHAR(64) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    address    TEXT NOT NULL,
    weight     INTEGER NOT NULL DEFAULT 1,
    tls_mode   INTEGER NOT NULL DEFAULT 0,                                    -- TLSMode enum
    healthy    TINYINT(1) NOT NULL DEFAULT 1,                                 -- boolean 0/1
    dial_err   TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_upstreams_service_id ON upstreams (service_id);

-- --------------------------------------------------------------------------------
-- Core: policies (rate limit, auth, transform, etc.)
-- --------------------------------------------------------------------------------
CREATE TABLE policies (
    id         VARCHAR(64) PRIMARY KEY,                                       -- UUID
    name       TEXT NOT NULL UNIQUE,
    type       INTEGER NOT NULL,                                              -- PolicyType enum
    config     TEXT NOT NULL DEFAULT '{}',                                    -- JSON policy-specific configuration
    labels     TEXT,                                             -- JSON object
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_policies_name ON policies (name);
CREATE INDEX idx_policies_type ON policies (type);

-- --------------------------------------------------------------------------------
-- Core: policy_bindings (many-to-many between policies and routes/services)
-- --------------------------------------------------------------------------------
CREATE TABLE policy_bindings (
    policy_id   VARCHAR(64) NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('route', 'service')),
    target_id   VARCHAR(64) NOT NULL,

    PRIMARY KEY (policy_id, target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_policy_bindings_target ON policy_bindings (target_type, target_id);

-- --------------------------------------------------------------------------------
-- Identity: api_keys
-- --------------------------------------------------------------------------------
CREATE TABLE api_keys (
    id         VARCHAR(64) PRIMARY KEY,                                       -- UUID
    name       TEXT NOT NULL,
    key_hash   VARCHAR(255) NOT NULL UNIQUE,
    scopes     TEXT NOT NULL DEFAULT '[]',                                    -- JSON array of scope strings
    expires_at DATETIME(6),                                                   -- ISO8601, nullable = no expiry
    created_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6)                                                    -- ISO8601, nullable = not revoked
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_name     ON api_keys (name);

-- --------------------------------------------------------------------------------
-- Ops: config_versions (full config snapshots for rollback)
-- --------------------------------------------------------------------------------
CREATE TABLE config_versions (
    version    BIGINT AUTO_INCREMENT PRIMARY KEY,
    snapshot   LONGTEXT NOT NULL,                                             -- JSON-encoded ConfigSnapshot
    actor      TEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------
-- Ops: audit_log (append-only mutation log)
-- --------------------------------------------------------------------------------
CREATE TABLE audit_log (
    id             VARCHAR(64) PRIMARY KEY,                                   -- UUID
    actor          TEXT NOT NULL,
    entity_type    TEXT NOT NULL,
    entity_id      TEXT NOT NULL,
    operation      TEXT NOT NULL,
    diff           TEXT,                                         -- JSON
    config_version BIGINT NOT NULL,
    occurred_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_audit_log_entity      ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_actor       ON audit_log (actor);
CREATE INDEX idx_audit_log_occurred_at ON audit_log (occurred_at);

-- --------------------------------------------------------------------------------
-- Migrations: schema_versions (pre-created by driver but included here for completeness)
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_versions (
    version    INTEGER PRIMARY KEY,
    dirty      TINYINT(1) NOT NULL DEFAULT 0,
    applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (1, 0);
