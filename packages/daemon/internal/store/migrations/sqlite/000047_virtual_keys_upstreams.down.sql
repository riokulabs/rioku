ALTER TABLE virtual_keys DROP COLUMN upstreams;
ALTER TABLE virtual_keys DROP COLUMN routing_strategy;
ALTER TABLE virtual_keys DROP COLUMN routing_config;
DELETE FROM schema_versions WHERE version = 47;
