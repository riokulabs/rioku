--------------------------------------------------------------------------------
-- Plugins + PluginSigners (stage-2).
--
-- tenant_scope is NULLABLE: NULL = global plugin/signer (super-admin
-- only), non-null = tenant-scoped install.
--
-- Plugins represent an installed (or pending-install) plugin instance.
-- Marketplace listings live separately and aren't kept in this table.
--------------------------------------------------------------------------------

CREATE TABLE plugin_signers (
    id            TEXT PRIMARY KEY,
    tenant_scope  TEXT REFERENCES tenants(id) ON DELETE CASCADE,            -- NULL for global signers
    name          TEXT NOT NULL,
    fingerprint   TEXT NOT NULL,                                            -- e.g. cosign public key fingerprint
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('verified','revoked','pending')),
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- Fingerprint is unique per scope: a global signer and a tenant signer
    -- may have the same fingerprint (different policies).
    UNIQUE (tenant_scope, fingerprint)
);
CREATE INDEX idx_plugin_signers_tenant ON plugin_signers (tenant_scope);

CREATE TABLE plugins (
    id              TEXT PRIMARY KEY,
    tenant_scope    TEXT REFERENCES tenants(id) ON DELETE CASCADE,          -- NULL for global plugins
    slug            TEXT NOT NULL,                                          -- e.g. "rate-limit-redis"
    name            TEXT NOT NULL,
    version         TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    build_state     TEXT NOT NULL DEFAULT 'stable' CHECK (build_state IN ('stable','building','failed')),
    cosign_verified INTEGER NOT NULL DEFAULT 0,
    signer_id       TEXT REFERENCES plugin_signers(id) ON DELETE SET NULL,
    config          TEXT NOT NULL DEFAULT '{}',                             -- JSON
    metadata        TEXT NOT NULL DEFAULT '{}',                             -- JSON {build_log_url, manifest_hash, ...}
    last_build_log  TEXT,                                                   -- truncated tail
    installed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_scope, slug)
);
CREATE INDEX idx_plugins_tenant ON plugins (tenant_scope);
CREATE INDEX idx_plugins_signer ON plugins (signer_id);
