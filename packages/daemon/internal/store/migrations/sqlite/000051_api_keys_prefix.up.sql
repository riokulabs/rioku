-- 000051_api_keys_prefix.up.sql
-- Adds a `prefix` column to api_keys that holds a non-secret display prefix
-- (e.g. the first 12 chars of the raw token: `rku_tok_AbCd`). The prefix lets
-- the admin panel and CLI identify a key in lists, audit logs, and support
-- channels without ever showing the secret. NULL/empty for legacy rows
-- (created before this migration) — the UI must tolerate empty prefixes.

ALTER TABLE api_keys ADD COLUMN prefix TEXT NOT NULL DEFAULT '';
