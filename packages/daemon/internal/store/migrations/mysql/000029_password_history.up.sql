-- Password history table for reuse prevention (#115).
CREATE TABLE password_history (
    id            VARCHAR(255) PRIMARY KEY,
    user_id       VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_password_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_password_history_user ON password_history (user_id, created_at DESC);

ALTER TABLE tenant_auth_policies ADD COLUMN password_history_count INT NOT NULL DEFAULT 5;
