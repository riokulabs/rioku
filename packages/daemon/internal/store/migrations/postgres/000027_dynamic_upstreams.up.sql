-- Phase 7b / #162: dynamic upstreams.
-- Adds source_type and source_json columns to upstreams so that DNS-based
-- dynamic sources (SRV / A) can be stored alongside the existing static
-- address column. When source_type is empty the upstream is treated as
-- static (backward-compatible default).

ALTER TABLE upstreams ADD COLUMN source_type TEXT NOT NULL DEFAULT '';
ALTER TABLE upstreams ADD COLUMN source_json TEXT NOT NULL DEFAULT '{}';

INSERT INTO schema_versions (version, dirty) VALUES (27, FALSE)
    ON CONFLICT (version) DO NOTHING;
