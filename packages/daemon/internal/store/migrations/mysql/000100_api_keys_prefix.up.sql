-- 000051_api_keys_prefix.up.sql
-- Adds a `prefix` column to api_keys that holds a non-secret display prefix.

ALTER TABLE api_keys ADD COLUMN prefix VARCHAR(64) NOT NULL DEFAULT '';
