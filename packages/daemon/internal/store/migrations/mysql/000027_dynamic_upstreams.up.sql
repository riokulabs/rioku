-- Phase 7b / #162: dynamic upstreams.
-- Adds source_type and source_json columns to upstreams so that DNS-based
-- dynamic sources (SRV / A) can be stored alongside the existing static
-- address column. MySQL TEXT columns do not support DEFAULT expressions,
-- so existing rows are backfilled with a separate UPDATE.

ALTER TABLE upstreams ADD COLUMN source_type TEXT NOT NULL;
ALTER TABLE upstreams ADD COLUMN source_json TEXT NOT NULL;

UPDATE upstreams SET source_type = '', source_json = '{}'
    WHERE source_type IS NULL OR source_type = '';

INSERT IGNORE INTO schema_versions (version, dirty) VALUES (27, 0);
