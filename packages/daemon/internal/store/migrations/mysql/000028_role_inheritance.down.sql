ALTER TABLE roles DROP FOREIGN KEY fk_roles_parent;
DROP INDEX idx_roles_parent ON roles;
ALTER TABLE roles DROP COLUMN parent_role_id;
