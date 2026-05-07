CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token       VARCHAR(128) NOT NULL PRIMARY KEY,
  user_id     VARCHAR(36)  NOT NULL,
  created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at  DATETIME(6)  NOT NULL,
  consumed_at DATETIME(6)
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
