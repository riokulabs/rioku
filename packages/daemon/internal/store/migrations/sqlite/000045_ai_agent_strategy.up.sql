-- Sprint 5 Phase 3 (#168): per-agent routing strategy + config.
--
-- routing_strategy is the registered name in the strategies
-- registry (simple_shuffle | fallback | latency, plus future
-- additions). routing_config is a JSON blob that the strategy
-- constructor consumes (e.g. fallback's "triggers" override,
-- latency's "decay" parameter).
--
-- Default 'fallback' picks the safest behavior for v1 — operators
-- who configured a single upstream see no behavioral change.
ALTER TABLE ai_agents ADD COLUMN routing_strategy TEXT NOT NULL DEFAULT 'fallback';
ALTER TABLE ai_agents ADD COLUMN routing_config   TEXT NOT NULL DEFAULT '{}';
