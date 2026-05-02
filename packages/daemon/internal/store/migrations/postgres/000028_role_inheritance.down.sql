DROP INDEX IF EXISTS idx_roles_parent;
ALTER TABLE roles DROP COLUMN parent_role_id;
