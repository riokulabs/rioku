-- 000001_traces.down.sql: drop all trace store tables

DROP TABLE IF EXISTS trace_schema_versions;
DROP TABLE IF EXISTS model_buckets;
DROP TABLE IF EXISTS status_buckets;
DROP TABLE IF EXISTS route_buckets;
DROP TABLE IF EXISTS stats_buckets;
DROP TABLE IF EXISTS raw_traces;
