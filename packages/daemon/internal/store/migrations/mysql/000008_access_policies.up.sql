-- access_policies table — conditional access rules evaluated by the auth
-- middleware. Conditions are stored as a JSON array; each element is a
-- {type, config} object the daemon's policy engine knows how to evaluate
-- (time window, IP CIDR, MFA status, geo, device, custom CEL).
--
-- target_ids is a JSON array of role IDs (when target_type='roles') or
-- user IDs (when target_type='users'); empty array + target_type='all'
-- applies the policy globally.
--
-- Lower priority numbers evaluate first; ties break on created_at ASC.
CREATE TABLE access_policies (
    id VARCHAR(64) PRIMARY KEY,
    name            TEXT     NOT NULL UNIQUE,
    description     TEXT     NOT NULL DEFAULT '',
    effect          TEXT     NOT NULL CHECK (effect IN ('allow', 'deny')),
    target_type     TEXT     NOT NULL CHECK (target_type IN ('roles', 'users', 'all')),
    target_ids_json TEXT     NOT NULL DEFAULT '[]',
    conditions_json TEXT     NOT NULL DEFAULT '[]',
    priority        INTEGER  NOT NULL DEFAULT 100,
    enabled TINYINT(1) NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at DATETIME(6)     NOT NULL,
    updated_at DATETIME(6)     NOT NULL
 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_access_policies_enabled_priority
    ON access_policies (enabled, priority);

CREATE INDEX idx_access_policies_target_type
    ON access_policies (target_type);

-- Permissions for the new endpoints (#80, #84).
-- Read: list/get policies. Write: create/update/delete policies.
-- Manage: certificate renew/revoke.
INSERT INTO permissions (id, resource, action, description) VALUES
    ('access-policies:read',  'access-policies', 'read',   'View conditional access policies'),
    ('access-policies:write', 'access-policies', 'write',  'Create, update, delete conditional access policies'),
    ('certificates:read',     'certificates',    'read',   'View managed TLS certificates'),
    ('certificates:manage',   'certificates',    'manage', 'Force renewal or revoke certificates');

-- Grant the new permissions to the same roles that already manage RBAC.
-- superadmin already has '*' so it implicitly grants these too.
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('role_admin',    'access-policies:read'),
    ('role_admin',    'access-policies:write'),
    ('role_admin',    'certificates:read'),
    ('role_admin',    'certificates:manage'),
    ('role_operator', 'access-policies:read'),
    ('role_operator', 'certificates:read'),
    ('role_viewer',   'access-policies:read'),
    ('role_viewer',   'certificates:read');

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (8, 0);
