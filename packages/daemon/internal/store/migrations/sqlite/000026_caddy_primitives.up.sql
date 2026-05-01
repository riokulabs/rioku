-- Phase 7a / #161: Service-level Caddy primitives.
-- Adds JSON-encoded fields for request_headers, response_headers,
-- response_rules, and compression. Default values are empty objects/
-- arrays so existing rows continue to compile cleanly.

ALTER TABLE services ADD COLUMN request_headers TEXT NOT NULL DEFAULT '{}';
ALTER TABLE services ADD COLUMN response_headers TEXT NOT NULL DEFAULT '{}';
ALTER TABLE services ADD COLUMN response_rules TEXT NOT NULL DEFAULT '[]';
ALTER TABLE services ADD COLUMN compression TEXT NOT NULL DEFAULT '{}';

INSERT OR IGNORE INTO schema_versions (version, dirty) VALUES (26, 0);
