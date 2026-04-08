-- 000003_rbac.up.sql
-- RBAC: permissions, roles, role_permissions, user_roles tables with seed data.
-- NOTE: PRAGMA foreign_keys = ON must be set by the driver (already done in Open).

CREATE TABLE permissions (
    id          TEXT PRIMARY KEY,
    resource    TEXT NOT NULL,
    action      TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(resource, action)
);

CREATE TABLE roles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE role_permissions (
    role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);

CREATE TABLE user_roles (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_by TEXT REFERENCES users(id),
    granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

-- Seed atomic permissions
INSERT INTO permissions (id, resource, action, description) VALUES
    ('config:read',    'config',    'read',    'View routes, services, policies'),
    ('config:write',   'config',    'write',   'Create, update, delete routes/services/policies'),
    ('config:import',  'config',    'import',  'Import full config (replaces all)'),
    ('config:export',  'config',    'export',  'Export config snapshot'),
    ('keys:own',       'keys',      'own',     'Manage own API keys'),
    ('keys:manage',    'keys',      'manage',  'Manage all API keys'),
    ('users:read',     'users',     'read',    'View user list and details'),
    ('users:manage',   'users',     'manage',  'Update users, change roles, reset passwords'),
    ('users:create',   'users',     'create',  'Create new user accounts'),
    ('users:delete',   'users',     'delete',  'Delete user accounts'),
    ('roles:read',     'roles',     'read',    'View roles and permissions'),
    ('roles:manage',   'roles',     'manage',  'Create, update, delete custom roles'),
    ('sessions:read',  'sessions',  'read',    'View active sessions'),
    ('sessions:manage','sessions',  'manage',  'Revoke other users'' sessions'),
    ('audit:read',     'audit',     'read',    'View audit log'),
    ('settings:read',  'settings',  'read',    'View daemon settings'),
    ('settings:write', 'settings',  'write',   'Modify daemon settings'),
    ('traffic:read',   'traffic',   'read',    'View live traffic and analytics'),
    ('plugins:read',   'plugins',   'read',    'View installed plugins'),
    ('plugins:manage', 'plugins',   'manage',  'Install, remove, configure plugins'),
    ('cluster:read',   'cluster',   'read',    'View cluster status'),
    ('cluster:manage', 'cluster',   'manage',  'Join/remove nodes');

-- Seed wildcard permissions
INSERT INTO permissions (id, resource, action, description) VALUES
    ('*',          '*',         '*', 'All permissions (superadmin wildcard)'),
    ('config:*',   'config',   '*', 'All config permissions'),
    ('keys:*',     'keys',     '*', 'All keys permissions'),
    ('sessions:*', 'sessions', '*', 'All sessions permissions'),
    ('settings:*', 'settings', '*', 'All settings permissions'),
    ('plugins:*',  'plugins',  '*', 'All plugins permissions');

-- Seed built-in roles
INSERT INTO roles (id, name, description, is_builtin) VALUES
    ('role_superadmin', 'superadmin', 'Full access — all permissions via wildcard', 1),
    ('role_admin',      'admin',      'Manage existing users, sessions, config, and keys. Cannot create/delete accounts or modify role structure.', 1),
    ('role_operator',   'operator',   'Day-to-day operations: config, own keys, traffic, plugins. No user/session management.', 1),
    ('role_viewer',     'viewer',     'Read-only access to config, audit, settings, traffic, plugins, cluster.', 1);

-- superadmin: wildcard
INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_superadmin', '*');

-- admin scopes
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('role_admin', 'config:*'),
    ('role_admin', 'keys:*'),
    ('role_admin', 'users:read'),
    ('role_admin', 'users:manage'),
    ('role_admin', 'roles:read'),
    ('role_admin', 'sessions:*'),
    ('role_admin', 'audit:read'),
    ('role_admin', 'settings:*'),
    ('role_admin', 'traffic:read'),
    ('role_admin', 'plugins:*'),
    ('role_admin', 'cluster:read');

-- operator scopes
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('role_operator', 'config:*'),
    ('role_operator', 'keys:own'),
    ('role_operator', 'audit:read'),
    ('role_operator', 'settings:read'),
    ('role_operator', 'traffic:read'),
    ('role_operator', 'plugins:read'),
    ('role_operator', 'cluster:read');

-- viewer scopes
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('role_viewer', 'config:read'),
    ('role_viewer', 'audit:read'),
    ('role_viewer', 'settings:read'),
    ('role_viewer', 'traffic:read'),
    ('role_viewer', 'plugins:read'),
    ('role_viewer', 'cluster:read');

-- Assign superadmin role to root user (if exists)
INSERT OR IGNORE INTO user_roles (user_id, role_id)
    SELECT id, 'role_superadmin' FROM users WHERE username = 'root';

INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (3, 0);
