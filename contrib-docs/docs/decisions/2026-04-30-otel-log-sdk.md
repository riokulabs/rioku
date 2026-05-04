# Decision: Hard `otel/sdk/log` Dep for OTLP Log Shipping

**Date**: 2026-04-30
**Issue**: #139
**Status**: Accepted

## Context

The daemon's logging stack uses Go's standard `log/slog`. We want to
ship logs over OTLP for ingestion by observability platforms. There
are two patterns:

1. **Hard dep**: import `go.opentelemetry.io/otel/sdk/log` and
   `.../exporters/otlp/otlplog/otlploghttp` directly. Pros: simple,
   consistent with #138 (which already hard-depends on
   `otelhttp`); cons: ~6 MB binary growth, OTel SDK API instability
   risk.

2. **Pluggable handler interface**: define `internal/logging.Sink`
   interface; ship the OTLP implementation as an optional plugin.
   Pros: clean separation, optional weight; cons: extra abstraction
   layer, more code.

## Decision

**Hard dep.** We already use `go.opentelemetry.io/otel` directly via
the `otelhttp` middleware (#138). Adding `otel/sdk/log` is consistent
with that choice. The OTel SDK has reached `v1.x` for the core API
which gives us reasonable stability; the log SDK is still pre-1.x
but the integration surface is small enough to absorb breakage.

The pluggable-handler abstraction is **not justified** for a single
implementation. If we later add a second sink (e.g., direct
Loki/Honeycomb push), we can refactor at that point.

## Consequences

- New direct deps in `packages/daemon/go.mod`:
  - `go.opentelemetry.io/otel/log` (the API)
  - `go.opentelemetry.io/otel/log/global` (global provider accessor)
  - `go.opentelemetry.io/otel/sdk/log` (the SDK)
  - `go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp` (HTTP exporter)
  - `go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc` (gRPC exporter)
- Binary size grows by ~6 MB. Acceptable for a daemon.
- Future log sinks can be added without revisiting this decision.
