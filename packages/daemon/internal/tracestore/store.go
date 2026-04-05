// Package tracestore implements the request trace persistence layer.
// Traces live in a separate store from config (different access pattern:
// high-write, append-only, time-range queries). Implementations: SQLite
// (Phase 1) and DuckDB (Phase 2+).
package tracestore
