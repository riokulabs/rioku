ALTER TABLE services ADD COLUMN dial_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN response_header_timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN idle_timeout_seconds INTEGER NOT NULL DEFAULT 0;
