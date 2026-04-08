DROP INDEX IF EXISTS idx_sessions_expires;
DROP INDEX IF EXISTS idx_sessions_user_id;
DROP TABLE IF EXISTS sessions;
DROP INDEX IF EXISTS idx_users_username;
DROP TABLE IF EXISTS users;
DELETE FROM schema_versions WHERE version = 2;
