-- 000024_rbac_policies.down.sql

DROP INDEX IF EXISTS idx_rbac_policies_unique;
DROP INDEX IF EXISTS idx_rbac_policies_role;
DROP INDEX IF EXISTS idx_rbac_policies_subject;
DROP INDEX IF EXISTS idx_rbac_policies_tenant;
DROP TABLE IF EXISTS rbac_policies;
