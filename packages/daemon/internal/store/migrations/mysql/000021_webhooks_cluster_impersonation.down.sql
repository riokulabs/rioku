DROP INDEX IF EXISTS idx_impersonation_active;
DROP INDEX IF EXISTS idx_impersonation_super_admin;
DROP TABLE IF EXISTS impersonation_sessions;
DROP INDEX IF EXISTS idx_cluster_tokens_unconsumed;
DROP TABLE IF EXISTS cluster_enrollment_tokens;
DROP INDEX IF EXISTS idx_webhook_endpoints_tenant;
DROP TABLE IF EXISTS webhook_endpoints;
DELETE FROM schema_versions WHERE version = 21;
