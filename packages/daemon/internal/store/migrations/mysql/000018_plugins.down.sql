DROP INDEX IF EXISTS idx_plugins_signer;
DROP INDEX IF EXISTS idx_plugins_tenant;
DROP TABLE IF EXISTS plugins;
DROP INDEX IF EXISTS idx_plugin_signers_tenant;
DROP TABLE IF EXISTS plugin_signers;
DELETE FROM schema_versions WHERE version = 18;
