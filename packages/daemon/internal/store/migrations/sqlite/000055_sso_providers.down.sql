DELETE FROM permissions WHERE id IN ('sso:read','sso:write') AND source = 'built-in';
DROP INDEX IF EXISTS idx_sso_providers_tenant;
DROP TABLE IF EXISTS sso_providers;
