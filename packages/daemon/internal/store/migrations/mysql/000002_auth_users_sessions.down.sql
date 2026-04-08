DROP INDEX idx_sessions_expires ON sessions;
DROP INDEX idx_sessions_user_id ON sessions;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DELETE FROM schema_versions WHERE version = 2;
