-- 000051_api_keys_prefix.down.sql
-- SQLite supports DROP COLUMN since 3.35 (2021-03).
ALTER TABLE api_keys DROP COLUMN prefix;
