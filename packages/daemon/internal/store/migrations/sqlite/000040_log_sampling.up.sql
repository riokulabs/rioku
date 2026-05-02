-- Per-route log sample rate (#119).
-- Routes with sample_rate < 1.0 emit only a fraction of their access
-- log records. Sampling is deterministic by request_id so a request's
-- decision is consistent across all log destinations and across the
-- trace store. Default 1.0 = log every request.
ALTER TABLE routes ADD COLUMN log_sample_rate REAL NOT NULL DEFAULT 1.0;
