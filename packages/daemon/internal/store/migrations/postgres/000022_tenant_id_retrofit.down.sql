DROP INDEX IF EXISTS idx_roles_tenant;
ALTER TABLE roles DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS idx_access_policies_tenant;
ALTER TABLE access_policies DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS idx_sessions_tenant;
ALTER TABLE sessions DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS idx_audit_log_tenant;
ALTER TABLE audit_log DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS idx_api_keys_tenant;
ALTER TABLE api_keys DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS idx_policies_tenant;
ALTER TABLE policies DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS idx_services_tenant;
ALTER TABLE services DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS idx_routes_tenant;
ALTER TABLE routes DROP COLUMN IF EXISTS tenant_id;
