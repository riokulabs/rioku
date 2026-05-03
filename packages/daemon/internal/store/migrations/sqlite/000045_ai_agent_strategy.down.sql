-- modernc.org/sqlite supports DROP COLUMN (>= 3.35).
ALTER TABLE ai_agents DROP COLUMN routing_strategy;
ALTER TABLE ai_agents DROP COLUMN routing_config;
DELETE FROM schema_versions WHERE version = 45;
