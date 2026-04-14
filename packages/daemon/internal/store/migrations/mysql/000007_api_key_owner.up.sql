ALTER TABLE api_keys ADD COLUMN owner_id VARCHAR(36),
  ADD CONSTRAINT fk_api_keys_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_api_keys_owner ON api_keys(owner_id);
