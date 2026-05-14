# D8: AI Spend-Log Retention — 7-Day SpendLogs + Indefinite Daily Rollups + Opt-In Message Capture

**Date**: 2026-04-30
**Issue**: #166 (LiteLLM-vendored model registry + cost tracking)
**Status**: Accepted

## Context

Every AI request needs accounting:

- **Per-request spend log:** model, tokens, cost, latency,
  virtual-key, application, plan. High volume — one row per
  request.
- **Daily rollup:** aggregated `(tenant, key, model, date)`
  totals. Tiny — one row per active key-day.
- **Optional payload capture:** the prompt + the model's
  response, for replay / debugging. Privacy-sensitive,
  potentially enormous.

Retaining all three forever is operationally expensive (storage,
backup, GDPR exposure). Retaining nothing past a day kills
debugging. The question is the default retention and the opt-in
shape.

## Decision

Three retention tiers, each independent:

1. **`ai_spend_logs` table — 7-day default retention.** One row
   per AI request. Pruned by a background job hooked to the
   existing `audit_retention_config` cadence; the operator can
   raise the limit per tenant.
2. **`ai_spend_rollups` table — indefinite retention.** One row
   per `(tenant_id, virtual_key_id, model_id, date)` tuple.
   Aggregated nightly by a background rollup goroutine. Tiny
   (kilobytes per active tenant-day) so indefinite storage is
   fine.
3. **Message + response payload columns — opt-in per tenant.**
   `ai_spend_logs.messages` and `ai_spend_logs.response` are
   nullable. Population is gated by a per-tenant
   `ai_capture_payloads` flag; off by default. When on, the
   payload is also subject to the redaction layer (D12 vault
   refs + #74 PII filters extended to AI) so PII never lands
   in the spend log.

## Why this split

- **Per-request granularity for debugging.** When a customer
  asks *"why did my OpenAI bill spike at 14:32?"* the spend log
  is the answer. Seven days is enough to catch invoice-cycle
  anomalies without retaining months of high-cardinality data.
- **Rollups for trend analytics.** The admin AI dashboard
  charts spend by day across weeks / months / quarters. Querying
  the spend log for that range is a full-table scan; querying
  the rollup is a point lookup.
- **Payload capture is a separate consent gate.** Capturing
  prompts is a GDPR / SOC2 / HIPAA-grade decision. Operators
  who don't need it shouldn't pay the storage tax or the
  privacy risk. Operators who do need it — for debugging
  prompt-injection mitigations or for replaying failed
  requests — get a flag.
- **Pruning logic reuses existing audit_retention_config.**
  The retention surface already exists as a singleton-per-tenant
  row from PR #153. AI spend logs add a `spend_log_retention_days`
  field; the existing prune loop gains a new query. No new cron
  framework, no new scheduling code.

## Why not simpler / different shapes

- **All-or-nothing retention** (e.g. "keep everything 30 days,
  drop everything after"): operators with high volume can't
  afford 30 days of rows but still want monthly trend
  visibility. The rollup-vs-log split is the lightest model
  that supports both use cases.
- **Hosted ClickHouse** (per the 2026-04-09 trace store decision):
  trace data is high-write, append-only, time-series-shaped —
  fits ClickHouse perfectly. Spend data is also time-series but
  the write rate is orders of magnitude lower (one row per AI
  request, not per HTTP request) and the query patterns
  (per-tenant aggregations) fit a standard SQL store fine. No
  reason to introduce a second columnar dependency.
- **Per-tenant retention overrides for the rollup table:**
  rejected for v1. Indefinite + tiny means there's no real cost
  to keeping it forever. If a tenant materially asks for "drop
  rollups older than N days," we add it; we don't preempt.

## Consequences

- **Migration 43 (Sprint 5 Phase 1f):** new tables `ai_spend_logs`
  - `ai_spend_rollups`. The spend log columns: `id, tenant_id,
  virtual_key_id, application_id, plan_id, model_id, provider_id,
  input_tokens, output_tokens, total_tokens, cost_usd,
  latency_ms, status, request_id, messages` (nullable),
  `response` (nullable), `created_at`. Rollup columns:
  `tenant_id, virtual_key_id, model_id, date, request_count,
  input_tokens_total, output_tokens_total, total_tokens,
  cost_usd_total, error_count`.
- **Aggregation job:** runs once per hour on the daemon (NOT
  per request) and folds the latest spend-log entries into
  the rollup. Idempotent on a `(tenant_id, virtual_key_id,
  model_id, date)` UNIQUE constraint — re-runs are safe.
- **Pruning:** `tx.PruneAISpendLogs(ctx, tenantID, before time.Time)`
  batched delete; the audit-retention cadence calls it.
- **Payload capture flag** lives on a new `ai_capture_payloads`
  column on the existing `ai_settings` per-tenant singleton
  (or a new `ai_settings` if that table doesn't exist yet).
  Default false.
- **Redaction:** when payload capture is on, the spend-log
  emitter pipes the messages + response through the same
  redaction stack the slog handler uses (#74). Operators get
  consistent PII handling whether the data lands in logs or
  spend records.
