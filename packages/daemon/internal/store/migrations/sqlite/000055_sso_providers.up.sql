--------------------------------------------------------------------------------
-- Plan 17b: SSO providers — per-tenant CRUD for OIDC/SAML provider config.
--
-- Admin-side surface only: this table stores which providers are wired to a
-- tenant and the parameters needed to bootstrap them. The runtime data-plane
-- (OIDC/SAML middleware, see #170) consumes this config but lives elsewhere.
--
-- `kind` is currently 'oidc' only; 'saml' is reserved as a forward-compat
-- enum value so tomorrow's metadata-URL fields can land without another
-- schema bump.
--
-- Sensitive material (client secrets) is not stored in this table. Callers
-- pass an `oidc_client_secret_ref` that resolves through the secret
-- indirection layer (#169).
--------------------------------------------------------------------------------

CREATE TABLE sso_providers (
    id                       TEXT PRIMARY KEY,
    tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                     TEXT NOT NULL,
    kind                     TEXT NOT NULL CHECK (kind IN ('oidc','saml')),
    oidc_issuer              TEXT,
    oidc_client_id           TEXT,
    oidc_client_secret_ref   TEXT,
    oidc_scopes              TEXT NOT NULL DEFAULT '[]',                                -- JSON array of strings
    claims_mapping           TEXT NOT NULL DEFAULT '{}',                                -- JSON object: daemon_claim -> provider_claim
    enabled                  INTEGER NOT NULL DEFAULT 1,
    created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tenant_id, name)
);
CREATE INDEX idx_sso_providers_tenant ON sso_providers (tenant_id);

-- Permission catalog: sso:read / sso:write.
INSERT INTO permissions (id, resource, action, description, source) VALUES
    ('sso:read',  'sso', 'read',  'View configured SSO providers for a tenant', 'built-in'),
    ('sso:write', 'sso', 'write', 'Create, update, or delete SSO providers for a tenant', 'built-in')
ON CONFLICT(id) DO NOTHING;
