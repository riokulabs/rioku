ALTER TABLE ai_agents ADD COLUMN routing_strategy TEXT NOT NULL DEFAULT ('fallback');
ALTER TABLE ai_agents ADD COLUMN routing_config   TEXT NOT NULL DEFAULT ('{}');
