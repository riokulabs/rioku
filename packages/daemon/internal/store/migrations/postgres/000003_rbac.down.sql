-- 000003_rbac.down.sql (postgres)
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS permissions;
DELETE FROM schema_versions WHERE version = 3;
