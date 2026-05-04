-- Per-route log sample rate (#119).
ALTER TABLE routes ADD COLUMN log_sample_rate DOUBLE PRECISION NOT NULL DEFAULT 1.0;
