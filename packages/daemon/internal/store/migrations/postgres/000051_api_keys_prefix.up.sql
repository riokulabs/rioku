-- 000051_api_keys_prefix.up.sql
-- Adds a `prefix` column to api_keys that holds a non-secret display prefix
-- (e.g. `rku_tok_AbCd`). NULL/empty for legacy rows.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS prefix TEXT NOT NULL DEFAULT '';
