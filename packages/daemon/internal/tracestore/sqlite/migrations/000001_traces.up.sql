-- 000001_traces.up.sql: initial trace store schema

CREATE TABLE IF NOT EXISTS raw_traces (
    trace_id            TEXT PRIMARY KEY,
    span_id             TEXT NOT NULL DEFAULT '',
    session_id          TEXT NOT NULL DEFAULT '',
    started_at          TEXT NOT NULL,
    duration_ms         INTEGER NOT NULL DEFAULT 0,
    upstream_duration_ms INTEGER NOT NULL DEFAULT 0,
    method              TEXT NOT NULL DEFAULT '',
    path                TEXT NOT NULL DEFAULT '',
    host                TEXT NOT NULL DEFAULT '',
    route_id            TEXT NOT NULL DEFAULT '',
    service_id          TEXT NOT NULL DEFAULT '',
    upstream_addr       TEXT NOT NULL DEFAULT '',
    status_code         INTEGER NOT NULL DEFAULT 0,
    bytes_sent          INTEGER NOT NULL DEFAULT 0,
    bytes_recv          INTEGER NOT NULL DEFAULT 0,
    actor_id            TEXT NOT NULL DEFAULT '',
    actor_type          TEXT NOT NULL DEFAULT '',
    policy_ids          TEXT NOT NULL DEFAULT '[]',
    rate_limit_hit      INTEGER NOT NULL DEFAULT 0,
    auth_result         TEXT NOT NULL DEFAULT '',
    ai_provider         TEXT NOT NULL DEFAULT '',
    ai_model            TEXT NOT NULL DEFAULT '',
    ai_input_tokens     INTEGER NOT NULL DEFAULT 0,
    ai_output_tokens    INTEGER NOT NULL DEFAULT 0,
    ai_total_tokens     INTEGER NOT NULL DEFAULT 0,
    ai_estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
    ai_is_streaming     INTEGER NOT NULL DEFAULT 0,
    ai_finish_reason    TEXT NOT NULL DEFAULT '',
    ai_session_id       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_raw_traces_started_at ON raw_traces (started_at);
CREATE INDEX IF NOT EXISTS idx_raw_traces_status_started ON raw_traces (status_code, started_at);
CREATE INDEX IF NOT EXISTS idx_raw_traces_route_started ON raw_traces (route_id, started_at);
CREATE INDEX IF NOT EXISTS idx_raw_traces_session ON raw_traces (session_id);

CREATE TABLE IF NOT EXISTS stats_buckets (
    bucket_start    TEXT PRIMARY KEY,
    request_count   INTEGER NOT NULL DEFAULT 0,
    error_count     INTEGER NOT NULL DEFAULT 0,
    p50_latency_ms  INTEGER NOT NULL DEFAULT 0,
    p95_latency_ms  INTEGER NOT NULL DEFAULT 0,
    p99_latency_ms  INTEGER NOT NULL DEFAULT 0,
    bytes_sent      INTEGER NOT NULL DEFAULT 0,
    bytes_recv      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS route_buckets (
    bucket_start    TEXT NOT NULL,
    route_id        TEXT NOT NULL,
    request_count   INTEGER NOT NULL DEFAULT 0,
    error_count     INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_start, route_id)
);

CREATE TABLE IF NOT EXISTS status_buckets (
    bucket_start    TEXT NOT NULL,
    status_class    TEXT NOT NULL,
    request_count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_start, status_class)
);

CREATE TABLE IF NOT EXISTS model_buckets (
    bucket_start        TEXT NOT NULL,
    provider            TEXT NOT NULL,
    model               TEXT NOT NULL,
    request_count       INTEGER NOT NULL DEFAULT 0,
    total_tokens        INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd  REAL NOT NULL DEFAULT 0.0,
    PRIMARY KEY (bucket_start, provider, model)
);

CREATE TABLE IF NOT EXISTS trace_schema_versions (
    version     INTEGER NOT NULL,
    dirty       INTEGER NOT NULL DEFAULT 0,
    applied_at  TEXT NOT NULL DEFAULT ''
);
