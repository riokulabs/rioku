DROP TABLE IF EXISTS audit_retention_configs;
DROP TABLE IF EXISTS observability_configs;
DROP TABLE IF EXISTS tenant_auth_policies;
DROP TABLE IF EXISTS network_configs;
DELETE FROM schema_versions WHERE version = 20;
