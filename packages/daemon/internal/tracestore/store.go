// Package tracestore implements the request trace persistence layer.
// Traces live in a separate store from config (different access pattern:
// high-write, append-only, time-range queries).
//
// Architecture:
//   - Ring buffer (in-memory) for live SSE stream and real-time dashboard
//   - SQLite (default) or external DB for historical queries
//   - Pre-aggregated bucket tables for dashboard chart queries
//
// The ring buffer is always active. The persistent store is pluggable
// via the Driver interface with Register/New following the same pattern
// as the config store.
package tracestore
