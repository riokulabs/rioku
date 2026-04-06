-- 000001_initial.down.sql
-- Reverse the initial schema migration.
-- Tables are dropped in reverse dependency order to respect foreign keys.

DROP TABLE IF EXISTS schema_versions;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS config_versions;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS policy_bindings;
DROP TABLE IF EXISTS policies;
DROP TABLE IF EXISTS upstreams;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS services;
