-- 000006_user_deleted_status.up.sql
-- Add 'deleted' to the user status CHECK constraint.
-- SQLite requires recreating the table to alter a CHECK constraint.

PRAGMA foreign_keys=OFF;

CREATE TABLE users_new (
    id                    TEXT PRIMARY KEY,
    username              TEXT NOT NULL UNIQUE,
    email                 TEXT,
    display_name          TEXT,
    password_hash         TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'locked', 'deleted')),
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

INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX idx_users_username ON users (username);

PRAGMA foreign_keys=ON;

INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (6, 0);
