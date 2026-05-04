DROP INDEX IF EXISTS idx_membership_roles_role;
DROP TABLE IF EXISTS membership_roles;

DROP INDEX IF EXISTS idx_memberships_state;
DROP INDEX IF EXISTS idx_memberships_user;
DROP INDEX IF EXISTS idx_memberships_tenant;
DROP TABLE IF EXISTS memberships;

DROP INDEX IF EXISTS idx_tenants_slug;
DROP TABLE IF EXISTS tenants;
