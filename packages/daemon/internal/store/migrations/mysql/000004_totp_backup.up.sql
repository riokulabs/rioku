-- 000004_totp_backup.up.sql (mysql)
CREATE TABLE totp_backup_codes (
    id        VARCHAR(36)  NOT NULL PRIMARY KEY,
    user_id   VARCHAR(36)  NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    used_at   DATETIME(3),
    CONSTRAINT fk_tbc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    KEY idx_totp_backup_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (4, 0);
