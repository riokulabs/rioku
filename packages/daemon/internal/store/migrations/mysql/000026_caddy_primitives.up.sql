-- Phase 7a / #161: Service-level Caddy primitives.
-- Adds JSON-encoded columns for request_headers, response_headers,
-- response_rules, and compression. MySQL TEXT columns do not support
-- DEFAULT expressions, so existing rows are backfilled with a separate UPDATE.

ALTER TABLE services ADD COLUMN request_headers TEXT NOT NULL;
ALTER TABLE services ADD COLUMN response_headers TEXT NOT NULL;
ALTER TABLE services ADD COLUMN response_rules TEXT NOT NULL;
ALTER TABLE services ADD COLUMN compression TEXT NOT NULL;

UPDATE services SET request_headers = '{}', response_headers = '{}',
    response_rules = '[]', compression = '{}'
    WHERE request_headers IS NULL OR request_headers = '';

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (26, 0);
