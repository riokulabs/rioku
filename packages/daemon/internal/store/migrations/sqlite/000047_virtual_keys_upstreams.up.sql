-- Sprint 5 Phase 3 (#168, #200): per-virtual-key upstream list +
-- routing strategy slot.
--
-- A VK now optionally carries a JSON array of (provider_id,
-- weight, priority) tuples. When the array is empty the AI gateway
-- falls back to vk.provider_id (single-upstream v1 behavior).
-- routing_strategy / routing_config drive the daemon-side strategy
-- registry's Pick() / Observe() across the upstream list.
ALTER TABLE virtual_keys ADD COLUMN upstreams        TEXT NOT NULL DEFAULT '[]';
ALTER TABLE virtual_keys ADD COLUMN routing_strategy TEXT NOT NULL DEFAULT 'fallback';
ALTER TABLE virtual_keys ADD COLUMN routing_config   TEXT NOT NULL DEFAULT '{}';
