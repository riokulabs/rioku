-- Plan 17b: SSO providers — per-tenant CRUD for OIDC/SAML provider config.
-- Admin-side surface only; runtime data-plane plugin (#170) consumes this.
CREATE TABLE sso_providers (
    id                       VARCHAR(255) PRIMARY KEY,
    tenant_id                VARCHAR(255) NOT NULL,
    name                     VARCHAR(255) NOT NULL,
    kind                     VARCHAR(16)  NOT NULL,
    oidc_issuer              TEXT,
    oidc_client_id           TEXT,
    oidc_client_secret_ref   TEXT,
    oidc_scopes              JSON NOT NULL,
    claims_mapping           JSON NOT NULL,
    enabled                  TINYINT(1) NOT NULL DEFAULT 1,
    created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sso_providers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_sso_providers_tenant         ON sso_providers (tenant_id);
CREATE UNIQUE INDEX idx_sso_providers_tenant_name ON sso_providers (tenant_id, name);

INSERT IGNORE INTO permissions (id, resource, action, description, source) VALUES
    ('sso:read',  'sso', 'read',  'View configured SSO providers for a tenant', 'built-in'),
    ('sso:write', 'sso', 'write', 'Create, update, or delete SSO providers for a tenant', 'built-in');
