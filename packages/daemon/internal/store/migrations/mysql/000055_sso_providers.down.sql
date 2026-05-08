DELETE FROM permissions WHERE id IN ('sso:read','sso:write') AND source = 'built-in';
DROP INDEX idx_sso_providers_tenant_name ON sso_providers;
DROP INDEX idx_sso_providers_tenant ON sso_providers;
DROP TABLE IF EXISTS sso_providers;
