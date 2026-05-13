# D10: Token Counting Strategy — Tiktoken Approximation in v1, Exact Tokenizers in v2+

**Date**: 2026-04-30
**Issue**: #166
**Status**: Accepted

## Context

The AI gateway (#166) needs to count tokens on every request:

- **Pre-call** (input tokens) for budget enforcement (#167):
  reject the request before it goes upstream if the budget
  would be exceeded.
- **Post-call** (output tokens) for accurate cost calculation +
  rate-limit (TPM, Sprint 5 lift) + spend log.

Tokens are model-specific. OpenAI uses BPE-based tiktoken
encodings (`cl100k_base`, `o200k_base`). Anthropic uses its own
tokenizer. Gemini uses SentencePiece. Llama derivatives use
SentencePiece variants. Cohere uses BPE with proprietary vocab.

Three strategies:

1. **Exact per-model tokenizer.** Bundle the tokenizer for
   every supported model. Accurate to the byte. Heavy: each
   tokenizer is 1-10MB (vocabularies + merge rules); supporting
   the full LiteLLM model set means tens of megabytes added to
   the binary.
2. **Single approximation tokenizer.** Pick one tokenizer and
   use it for every model. Off by a few percent on most models,
   off by 10-30% on outliers (Anthropic + multilingual content).
3. **Provider-side counts.** Trust the provider's response
   `usage.prompt_tokens` + `usage.completion_tokens`. Accurate.
   But only available post-call, so unusable for budget
   enforcement; and providers can lie.

## Decision

**v1: tiktoken approximation, with provider-side reconciliation
post-call.** v2 adds bundled exact tokenizers for the high-volume
families (Anthropic Claude, Gemini Pro/Flash) when measured
approximation error materially exceeds 5% on canonical prompts.

Specifically:

- **Pre-call estimate:** count via `tiktoken-go` with the
  `cl100k_base` encoding regardless of upstream model. Use the
  estimate for budget gating, rate-limit, and the optimistic
  spend log entry.
- **Post-call reconcile:** when the upstream returns
  `usage.{prompt,completion}_tokens`, overwrite the spend log's
  token counts + cost with the provider's numbers. Caller-
  visible response carries the provider's numbers via
  `x-rioku-response-cost`.
- **Drift surfacing:** the daemon tracks `(estimate / actual)`
  ratios per model and exposes them on a metrics endpoint. When
  the ratio diverges materially (>5%), the operator sees a
  warning gauge — the trigger for v2's exact-tokenizer
  bundling.

## Why approximation

- **Pre-call latency.** Loading a model-specific tokenizer
  per request adds tens of milliseconds; loading once and
  pinning per request still adds binary weight per supported
  model. tiktoken-go is sub-millisecond and already a small
  dependency.
- **Coverage.** LiteLLM lists 2,692 models. Bundling exact
  tokenizers for every one is impossible (and most won't ever
  be used). Approximation covers the long tail; exact
  tokenizers fill in the high-volume head.
- **Reconciliation makes accuracy a budget issue, not a
  correctness issue.** Spend log + cost calculation always
  end up with the provider's reported numbers. Approximation
  error only affects the *pre-call gate* — and a 5%
  approximation error on a 1000-token prompt is 50 tokens,
  small enough that legitimate requests aren't accidentally
  rejected.

## Why not exact tokenizers up front

- **Binary weight.** tiktoken's BPE vocab is ~1.5 MB.
  Anthropic's tokenizer is similar. Bundling exact tokenizers
  for OpenAI + Anthropic + Gemini + Cohere + Mistral + Llama
  variants pushes ~30 MB of vocab data into the daemon binary.
- **Uneven release cadence.** Anthropic doesn't ship its
  tokenizer publicly; we'd reverse-engineer it. Drift on a new
  Claude release means our embedded tokenizer is wrong until
  we update. Approximation degrades gracefully; exact
  silently lies.
- **The model registry already vendors LiteLLM.** That JSON
  ships *prices*, not tokenizers. Adding tokenizer bundling is
  a separate operational pipeline (sync, audit, security
  posture for fetched binaries). Defer.

## Why not provider-side only

- **Budget enforcement requires a pre-call estimate.** A
  provider-only model means we can't reject a request before
  paying for it. Operators who set budget = 0 still pay for
  the request that exceeds the budget.
- **Provider trust.** The provider self-reports tokens. A
  badly-behaved provider could underreport to mask a billing
  attack. Tracking divergence between our estimate and theirs
  surfaces this; tracking only theirs makes it invisible.

## Consequences

- **`internal/ai/tokens` package** with `Estimate(modelID, text)
  (int, error)`. Backed by `tiktoken-go`. Returns the estimate
  - the encoding it used so callers can include the encoding
  name in spend log records (helps with reconciliation later).
- **Spend log row** records both the pre-call estimate (in a
  `estimated_tokens` column) and the post-call actual (in
  `total_tokens`). The reconcile path updates the actual and
  the cost.
- **Drift metric.** `rioku_ai_token_estimate_ratio` Prometheus
  gauge labelled by model. Exported to Sprint 1's existing
  metrics pipeline.
- **v2 bundling trigger.** When a model's drift ratio exceeds
  ±5% over a 24h window, file a follow-up to bundle the exact
  tokenizer for that model family. Don't preempt.
- **No new external dep beyond tiktoken-go.** Everything else
  is stdlib + the existing OpenAPI client patterns.
