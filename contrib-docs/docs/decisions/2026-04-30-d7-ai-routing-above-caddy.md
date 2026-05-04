# D7: AI Routing Layer — Above Caddy, Not Inside It

**Date**: 2026-04-30
**Issue**: #168
**Status**: Accepted

## Context

The AI gateway needs to pick which upstream LLM to send a
request to (fallback chain, latency-based, cost-based, virtual-
key allowed-models filter, …). The question is where that
selection happens:

1. **Inside Caddy.** A first-party `rioku_ai_router` Caddy
   handler module parses the inbound request, computes the
   selection, rewrites the upstream URL, and lets Caddy's
   reverse-proxy ship it.
2. **Above Caddy in the daemon.** The daemon owns a small AI
   gateway HTTP server that fronts every AI request, runs the
   selection logic in Go, and reverse-proxies the result. Caddy
   stays out of the AI path.

## Decision

**Above Caddy.** AI routing is daemon-side. Caddy's role for AI
requests is a thin pass-through to the daemon's AI gateway port.

## Why

- **Strategy registry needs Go.** Per #168, the routing
  strategies (simple-shuffle, fallback chain, latency EWMA,
  v2 cost-based + tag filtering, v3 CEL-conditional-DSL +
  capability-aware) are pluggable. The strategy registry +
  hot reload of strategies + per-strategy state (latency
  trackers, cost rollups, budget windows) live in the
  daemon's address space anyway. Pulling them into Caddy
  modules means duplicating the strategy registry + IPC for
  state lookup.
- **Token counting + cost calculation** must run on the
  daemon side too (D8 + D10 — spend-log retention + token
  counting strategy). The values get persisted in the
  daemon's store. Doing the routing in Caddy means an extra
  IPC hop just to attribute spend.
- **Vault-resolved provider credentials.** Per D12, the
  daemon resolves `{vault://...}` references at compile time.
  AI provider credentials are particularly leak-prone. Letting
  the daemon hold them — and never passing them to Caddy —
  keeps the trust boundary tight.
- **Caddy's reverse-proxy is over-fit for HTTP.** AI
  upstreams have additional concerns (streaming responses,
  sticky sessions for multi-turn chats, MCP transport). The
  daemon-side proxy can ship those without rebuilding Caddy
  primitives.

## Architecture

```
client ─→ Caddy (auth, rate-limit, logging, basic transforms)
       └→ daemon AI gateway port (selection + cost + virtual key
            check + token count + spend log + reverse-proxy to
            chosen upstream)
                └→ provider (OpenAI / Anthropic / Gemini / …)
```

Caddy still does the heavy lifting on the request edge: TLS
termination, auth (rioku_jwt / rioku_apikey / rioku_oidc),
basic rate-limit (rioku_ratelimit), trace ingestion, header
manipulation, OAS validation if applicable. When it hits an
AI route it `reverse_proxy`'s to the daemon's AI port.

The daemon's AI gateway then:
1. Resolves the virtual key (#167) → provider creds + allowed-
   models filter + budget.
2. Picks the upstream via the configured strategy (#168).
3. Counts input tokens (D10 tiktoken approximation; bundled
   exact tokenizers for Anthropic + Gemini in v2).
4. Forwards (with provider creds) to the chosen upstream.
5. Counts output tokens, computes cost, emits a spend log
   entry (D8 retention).
6. Returns the response (streaming-aware) to the original
   caller.

## Consequences

- **New daemon endpoint.** Bound to the same internal port
  family as the gateway / keyvalidator endpoints. Default
  `127.0.0.1:7792`.
- **AI traffic does not flow through bin/rioku-caddy plugins
  for routing-specific concerns.** Auth still does (jwt /
  apikey land before the reverse_proxy step); the daemon-side
  AI gateway is downstream of those.
- **Streaming.** The AI port's reverse proxy is built around
  Go's `net/http` server-sent event handling — not Caddy's
  buffered response model. Each upstream connection is a
  long-lived stream piped to the client.
- **Spend log + rollup persistence** lives in the config
  store (per D8). AI proxy writes are NOT in the config-mutation
  path; they go through a dedicated `tx.AppendAISpendLog` that
  doesn't bump config_version.
- **The traffic engine stays single-process.** This decision
  doesn't reopen D4 (per-tenant Caddy isolation). Caddy stays
  shared across tenants; the daemon's AI gateway is the per-
  tenant policy point.

## Future revisits

If WASM plugin runtime (per the 2026-04-06 spike) matures into
something that can host the strategy registry + token counter
in-Caddy without the IPC cost, we revisit. Until then the
daemon owns the AI path.
