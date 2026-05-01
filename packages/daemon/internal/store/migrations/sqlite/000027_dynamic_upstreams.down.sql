-- SQLite does not support DROP COLUMN in older versions; recreate the table.
-- In practice down migrations are rarely used in production.
CREATE TABLE upstreams_v26 AS SELECT id, service_id, address, weight, tls_mode, healthy, dial_err FROM upstreams;
DROP TABLE upstreams;
ALTER TABLE upstreams_v26 RENAME TO upstreams;

DELETE FROM schema_versions WHERE version = 27;
