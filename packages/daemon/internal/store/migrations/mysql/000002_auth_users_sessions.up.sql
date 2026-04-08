CREATE TABLE users (
    id                    VARCHAR(36) NOT NULL PRIMARY KEY,
    username              VARCHAR(64) NOT NULL UNIQUE,
    email                 VARCHAR(255),
    display_name          VARCHAR(255),
    password_hash         TEXT NOT NULL,
    status                ENUM('active','suspended','locked') NOT NULL DEFAULT 'active',
    totp_secret           TEXT,
    totp_enabled          TINYINT(1) NOT NULL DEFAULT 0,
    force_password_change TINYINT(1) NOT NULL DEFAULT 0,
    failed_attempts       INT NOT NULL DEFAULT 0,
    locked_until          DATETIME(3),
    last_login            DATETIME(3),
    password_changed_at   DATETIME(3) NOT NULL,
    created_at            DATETIME(3) NOT NULL DEFAULT (NOW(3)),
    updated_at            DATETIME(3) NOT NULL DEFAULT (NOW(3))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
    id          VARCHAR(36) NOT NULL PRIMARY KEY,
    user_id     VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    created_at  DATETIME(3) NOT NULL,
    expires_at  DATETIME(3) NOT NULL,
    last_active DATETIME(3) NOT NULL,
    ip_address  VARCHAR(45),
    user_agent  TEXT,
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_sessions_user_id ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (2, 0);
