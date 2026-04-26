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
    id              TEXT     PRIMARY KEY,
    name            TEXT     NOT NULL UNIQUE,
    description     TEXT     NOT NULL DEFAULT '',
    effect          TEXT     NOT NULL CHECK (effect IN ('allow', 'deny')),
    target_type     TEXT     NOT NULL CHECK (target_type IN ('roles', 'users', 'all')),
    target_ids_json TEXT     NOT NULL DEFAULT '[]',
    conditions_json TEXT     NOT NULL DEFAULT '[]',
    priority        INTEGER  NOT NULL DEFAULT 100,
    enabled         INTEGER  NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at      TEXT     NOT NULL,
    updated_at      TEXT     NOT NULL
);

CREATE INDEX idx_access_policies_enabled_priority
    ON access_policies (enabled, priority);

CREATE INDEX idx_access_policies_target_type
    ON access_policies (target_type);

-- Permissions for the new endpoints (#80).
-- Read: list/get policies. Write: create/update/delete policies.
INSERT INTO permissions (id, resource, action, description) VALUES
    ('access-policies:read',  'access-policies', 'read',  'View conditional access policies'),
    ('access-policies:write', 'access-policies', 'write', 'Create, update, delete conditional access policies');

-- Grant the new permissions to the same roles that already manage RBAC.
-- superadmin already has '*' so it implicitly grants these too.
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('role_admin',    'access-policies:read'),
    ('role_admin',    'access-policies:write'),
    ('role_operator', 'access-policies:read'),
    ('role_viewer',   'access-policies:read');
