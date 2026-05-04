-- Add parent_role_id to roles for inheritance + escalation prevention (#117).
-- A role with a non-NULL parent_role_id inherits the parent's effective
-- permission set (transitively, with cycle detection enforced at the
-- store layer). Built-in roles do NOT have parents.
ALTER TABLE roles ADD COLUMN parent_role_id VARCHAR(255) NULL;
ALTER TABLE roles ADD CONSTRAINT fk_roles_parent FOREIGN KEY (parent_role_id) REFERENCES roles(id) ON DELETE SET NULL;
CREATE INDEX idx_roles_parent ON roles (parent_role_id);
