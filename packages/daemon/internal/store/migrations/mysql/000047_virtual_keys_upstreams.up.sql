ALTER TABLE virtual_keys ADD COLUMN upstreams        TEXT NOT NULL DEFAULT ('[]');
ALTER TABLE virtual_keys ADD COLUMN routing_strategy TEXT NOT NULL DEFAULT ('fallback');
ALTER TABLE virtual_keys ADD COLUMN routing_config   TEXT NOT NULL DEFAULT ('{}');
