-- 000006_user_deleted_status.down.sql
-- Revert 'deleted' status: set any deleted users back to 'suspended', then
-- recreate the table with the original CHECK constraint.

PRAGMA foreign_keys=OFF;

UPDATE users SET status = 'suspended' WHERE status = 'deleted';

CREATE TABLE users_old (
    id                    TEXT PRIMARY KEY,
    username              TEXT NOT NULL UNIQUE,
    email                 TEXT,
    display_name          TEXT,
    password_hash         TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'locked')),
    totp_secret           TEXT,
    totp_enabled          INTEGER NOT NULL DEFAULT 0,
    force_password_change INTEGER NOT NULL DEFAULT 0,
    failed_attempts       INTEGER NOT NULL DEFAULT 0,
    locked_until          TEXT,
    last_login            TEXT,
    password_changed_at   TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO users_old SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_old RENAME TO users;

CREATE UNIQUE INDEX idx_users_username ON users (username);

PRAGMA foreign_keys=ON;

DELETE FROM schema_versions WHERE version = 6;
