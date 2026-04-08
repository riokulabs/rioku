-- 000003_rbac.up.sql (mysql)

CREATE TABLE permissions (
    id          VARCHAR(64) NOT NULL PRIMARY KEY,
    resource    VARCHAR(64) NOT NULL,
    action      VARCHAR(64) NOT NULL,
    description TEXT        NOT NULL,
    created_at  DATETIME(3) NOT NULL DEFAULT NOW(3),
    UNIQUE KEY uq_permissions_resource_action (resource, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE roles (
    id          VARCHAR(36)  NOT NULL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    description TEXT         NOT NULL,
    is_builtin  TINYINT(1)   NOT NULL DEFAULT 0,
    created_at  DATETIME(3)  NOT NULL DEFAULT NOW(3),
    updated_at  DATETIME(3)  NOT NULL DEFAULT NOW(3),
    UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE role_permissions (
    role_id       VARCHAR(36) NOT NULL,
    permission_id VARCHAR(64) NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_rp_role       FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
    CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    KEY idx_role_permissions_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_roles (
    user_id    VARCHAR(36) NOT NULL,
    role_id    VARCHAR(36) NOT NULL,
    granted_by VARCHAR(36),
    granted_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_ur_user       FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_ur_role       FOREIGN KEY (role_id)    REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_ur_granted_by FOREIGN KEY (granted_by) REFERENCES users(id),
    KEY idx_user_roles_user (user_id),
    KEY idx_user_roles_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
    ('sessions:manage','sessions',  'manage',  'Revoke other users\' sessions'),
    ('audit:read',     'audit',     'read',    'View audit log'),
    ('settings:read',  'settings',  'read',    'View daemon settings'),
    ('settings:write', 'settings',  'write',   'Modify daemon settings'),
    ('traffic:read',   'traffic',   'read',    'View live traffic and analytics'),
    ('plugins:read',   'plugins',   'read',    'View installed plugins'),
    ('plugins:manage', 'plugins',   'manage',  'Install, remove, configure plugins'),
    ('cluster:read',   'cluster',   'read',    'View cluster status'),
    ('cluster:manage', 'cluster',   'manage',  'Join/remove nodes'),
    ('*',              '*',         '*',       'All permissions (superadmin wildcard)'),
    ('config:*',       'config',    '*',       'All config permissions'),
    ('keys:*',         'keys',      '*',       'All keys permissions'),
    ('sessions:*',     'sessions',  '*',       'All sessions permissions'),
    ('settings:*',     'settings',  '*',       'All settings permissions'),
    ('plugins:*',      'plugins',   '*',       'All plugins permissions');

INSERT INTO roles (id, name, description, is_builtin) VALUES
    ('role_superadmin', 'superadmin', 'Full access — all permissions via wildcard', 1),
    ('role_admin',      'admin',      'Manage existing users, sessions, config, and keys. Cannot create/delete accounts or modify role structure.', 1),
    ('role_operator',   'operator',   'Day-to-day operations: config, own keys, traffic, plugins. No user/session management.', 1),
    ('role_viewer',     'viewer',     'Read-only access to config, audit, settings, traffic, plugins, cluster.', 1);

INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_superadmin', '*');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('role_admin', 'config:*'), ('role_admin', 'keys:*'),   ('role_admin', 'users:read'),
    ('role_admin', 'users:manage'), ('role_admin', 'roles:read'), ('role_admin', 'sessions:*'),
    ('role_admin', 'audit:read'), ('role_admin', 'settings:*'), ('role_admin', 'traffic:read'),
    ('role_admin', 'plugins:*'), ('role_admin', 'cluster:read');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('role_operator', 'config:*'), ('role_operator', 'keys:own'),   ('role_operator', 'audit:read'),
    ('role_operator', 'settings:read'), ('role_operator', 'traffic:read'),
    ('role_operator', 'plugins:read'), ('role_operator', 'cluster:read');

INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('role_viewer', 'config:read'), ('role_viewer', 'audit:read'), ('role_viewer', 'settings:read'),
    ('role_viewer', 'traffic:read'), ('role_viewer', 'plugins:read'), ('role_viewer', 'cluster:read');

-- Assign superadmin role to root user (if exists)
INSERT IGNORE INTO user_roles (user_id, role_id)
    SELECT id, 'role_superadmin' FROM users WHERE username = 'root';

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (3, 0);
