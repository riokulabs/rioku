-- 000024_rbac_policies.up.sql
--
-- RbacPolicy entity (stage-2 admin completion chunk 7b).
--
-- Distinct from `access_policies` (which gates request-time conditional
-- access by route/service/user attributes) and from the legacy `policies`
-- table (Caddy-handler config blobs). RBAC policies map subjects
-- (user / group / service-account) to roles within a tenant.
--
-- The admin panel "RBAC Policies" page edits this table.

CREATE TABLE rbac_policies (
    id           TEXT NOT NULL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant_default',
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    subject_type TEXT NOT NULL,                            -- user | group | service-account
    subject_id   TEXT NOT NULL,
    role_id      TEXT NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_rbac_policies_tenant ON rbac_policies(tenant_id);
CREATE INDEX idx_rbac_policies_subject ON rbac_policies(tenant_id, subject_type, subject_id);
CREATE INDEX idx_rbac_policies_role ON rbac_policies(tenant_id, role_id);

CREATE UNIQUE INDEX idx_rbac_policies_unique
  ON rbac_policies(tenant_id, subject_type, subject_id, role_id);

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (24, 0);
