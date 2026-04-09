# Compiler Hardening & Proto Enrichment

**Date:** 2026-04-09
**Status:** Approved
**Depends on:** TrafficService plan completing first (same branch)

## 1. Problem Statement

The Caddy config compiler generates basic reverse_proxy config but does not leverage many Caddy features that are critical for production API gateway use cases. The proto definitions are missing fields needed to expose these features to users. This creates several concrete problems:

1. **Streaming is broken** — proxied SSE and LLM streaming responses buffer instead of streaming because `flush_interval` is not set
2. **Client IPs are wrong behind load balancers** — `trusted_proxies` is not compiled, so rate limiting, WAF, audit, and IP filtering use the LB's IP
3. **No distributed tracing correlation** — trace IDs are generated in the daemon (`uuid.New()`), not propagated from/to upstream OTEL traces
4. **No Prometheus metrics** — Caddy's built-in metrics endpoint is not enabled
5. **No multi-tenant cert provisioning** — on-demand TLS has no `ask` endpoint to validate domain ownership
6. **Missing proxy features** — passive health checks, retries, timeouts, transport config, and header manipulation have no proto fields and no compiler support

## 2. Workstream 1: Compiler Critical Fixes

Small, high-leverage changes to `compiler.go` and daemon config. No proto changes needed.

### 2.1 Streaming support (`flush_interval`)

Add `"flush_interval": -1` to the reverse_proxy handler for all routes. Value `-1` means "flush immediately" — required for SSE, WebSocket upgrade responses, and LLM streaming. Without this, Caddy buffers response bodies until the upstream closes the connection.

**Implementation:** In `compileReverseProxy()`, add `"flush_interval": -1` to the handler map.

**Tests:**
- `TestCompile_FlushInterval` — verify compiled reverse_proxy has `flush_interval: -1`
- Sandbox smoke test: proxy an SSE endpoint through Rioku and verify events arrive in real-time (not batched)

### 2.2 Trusted proxies

Accept `trusted_proxies` config from `rioku.yaml` and compile into the server-level config. This makes `{client_ip}` resolve correctly behind load balancers.

```yaml
# rioku.yaml
server:
  trusted_proxies:
    ranges:
      - "10.0.0.0/8"
      - "172.16.0.0/12"
      - "192.168.0.0/16"
    headers:
      - "X-Forwarded-For"
      - "X-Real-IP"
    strict: true
```

**Implementation:** Add `TrustedProxies` field to `CompilerConfig` (or pass via `NewCompiler`). In `Compile()`, set `trusted_proxies`, `client_ip_headers`, and `trusted_proxies_strict` on the server block.

**Tests:**
- `TestCompile_TrustedProxies` — verify server block includes `trusted_proxies` with correct CIDR ranges
- `TestCompile_TrustedProxies_Strict` — verify `trusted_proxies_strict` is set when configured
- `TestCompile_TrustedProxies_Empty` — verify no `trusted_proxies` when not configured
- Sandbox smoke test: set trusted proxies, send request with `X-Forwarded-For` header, verify access log shows correct `client_ip`

### 2.3 Prometheus metrics

Add `"metrics": {}` to all compiled server blocks. This enables Caddy's built-in Prometheus metrics endpoint at `/metrics` on the admin API.

**Implementation:** In `Compile()`, add `"metrics": {}` to each server block map.

**Tests:**
- `TestCompile_MetricsEnabled` — verify all server blocks have `"metrics": {}`
- Sandbox smoke test: verify `curl http://localhost:2019/metrics` returns Prometheus exposition format after daemon starts

### 2.4 OpenTelemetry tracing handler

Inject the `tracing` handler at position 0 of every route's handler chain (before `rioku_vars`). This creates an OTEL span per request with W3C traceparent propagation and makes `{http.vars.trace_id}` and `{http.vars.span_id}` available in access logs.

Update the log format config to include `trace_id` and `span_id` fields.

Update the ingester (`ParseLogLine`) to use the trace_id from the Caddy log entry instead of generating `uuid.New()`.

**Handler chain order becomes:**
1. `tracing` (OTEL span creation)
2. `vars` (rioku_vars — route_id, service_id)
3. `reverse_proxy` (proxying)

**Implementation:**
- In `compileHandlerChain()`, prepend `{"handler": "tracing", "span": "rioku"}` before rioku_vars
- In log format extra fields, add `trace_id` mapped to `{http.vars.trace_id}` and `span_id` mapped to `{http.vars.span_id}`
- In `ingester.go`, read `trace_id` from the parsed log JSON and use it as the `RequestTrace.TraceId` field; fall back to `uuid.New()` if absent

**Tests:**
- `TestCompile_TracingHandler` — verify tracing handler is first in handler chain for every route
- `TestCompile_TracingHandler_SpanName` — verify span name is "rioku"
- `TestCompile_LogFormat_TraceFields` — verify log format includes trace_id and span_id extra fields
- `TestParseLogLine_UsesTraceIdFromLog` — verify ingester uses trace_id from log JSON when present
- `TestParseLogLine_FallbackUUID` — verify ingester falls back to uuid.New() when trace_id is absent (backwards compat)

### 2.5 On-demand TLS ask endpoint

Implement a localhost-only HTTP handler that Caddy calls before provisioning a certificate for an unknown domain. The handler queries the route table in the config store to validate that the domain is configured on at least one enabled route.

```json
{
  "apps": {
    "tls": {
      "automation": {
        "policies": [{
          "on_demand": true,
          "issuers": [{"module": "acme"}]
        }],
        "on_demand": {
          "ask": "http://127.0.0.1:7779/tls/ask",
          "interval": "5m",
          "burst": 10
        }
      }
    }
  }
}
```

**Implementation:**
- Add an internal HTTP handler at `127.0.0.1:7779/tls/ask` (configurable port) that accepts `?domain=<name>` and returns 200 if the domain exists in any enabled route's host matchers, 403 otherwise
- Start this handler in the daemon's startup sequence (before Caddy starts)
- Add the `on_demand` TLS automation config to the compiler output when on-demand TLS is enabled in `rioku.yaml`

**Tests:**
- `TestAskEndpoint_KnownDomain` — 200 for domain in route table
- `TestAskEndpoint_UnknownDomain` — 403 for domain not in any route
- `TestAskEndpoint_DisabledRoute` — 403 for domain only on disabled routes
- `TestAskEndpoint_WildcardMatch` — 200 for `sub.example.com` when route has `*.example.com`
- `TestAskEndpoint_NoQueryParam` — 400 when `domain` param missing
- `TestCompile_OnDemandTLS` — verify TLS automation policy includes `on_demand` and `ask` URL when configured
- `TestCompile_OnDemandTLS_Disabled` — verify no on-demand config when not enabled

## 3. Workstream 2: Proto & Compiler Enrichment

Proto definition changes + compiler updates. Requires `make proto` after proto changes.

### 3.1 Passive health checks

Add passive health check fields to the `HealthCheck` proto message. Caddy's passive health checks mark upstreams unhealthy based on observed failure patterns during normal proxying — no polling required.

```protobuf
message HealthCheck {
  // ... existing active health check fields ...

  // Passive health checks (inline failure detection)
  int32  passive_fail_duration_seconds = 10;  // window to track failures (0 = disabled)
  int32  passive_max_fails             = 11;  // failures in window to mark unhealthy
  int32  passive_unhealthy_latency_ms  = 12;  // latency threshold to count as failure
  repeated int32 passive_unhealthy_status = 13;  // status codes that count as failures
}
```

**Compiler:** In `compileHealthChecks()`, emit a `passive` block alongside the existing `active` block when passive fields are non-zero.

**Tests:**
- `TestCompile_PassiveHealthChecks` — verify passive block in compiled reverse_proxy config
- `TestCompile_PassiveHealthChecks_Disabled` — verify no passive block when all passive fields are zero
- `TestCompile_PassiveAndActiveHealthChecks` — verify both coexist correctly

### 3.2 Timeouts

Add timeout fields to the `Service` proto message. These control reverse_proxy transport and flush behavior.

```protobuf
message Service {
  // ... existing fields ...

  // Proxy timeouts
  string dial_timeout              = 9;   // e.g. "5s" — timeout connecting to upstream
  string response_header_timeout   = 10;  // e.g. "30s" — timeout waiting for response headers
  string idle_timeout              = 11;  // e.g. "120s" — idle connection timeout
}
```

**Compiler:** In `compileReverseProxy()`, emit transport config with these timeout values when non-empty. Override `flush_interval` default for routes marked as streaming.

**Tests:**
- `TestCompile_ServiceTimeouts` — verify transport config includes dial_timeout and response_header_timeout
- `TestCompile_ServiceTimeouts_Defaults` — verify no transport timeout block when fields are empty (Caddy uses its own defaults)

### 3.3 Retries

Add retry fields to the `Service` proto message.

```protobuf
message Service {
  // ... existing fields ...

  // Retry configuration
  int32          retries          = 12;  // max retry attempts (0 = Caddy default)
  repeated int32 retry_statuses   = 13;  // status codes that trigger retry (e.g. [502, 503, 504])
}
```

**Compiler:** In `compileReverseProxy()`, emit `load_balancing.retries` and `load_balancing.retry_match` when configured.

**Tests:**
- `TestCompile_Retries` — verify retries and retry_match in compiled config
- `TestCompile_Retries_StatusCodes` — verify retry_match includes correct status code matchers

### 3.4 Transport config (TLS to upstream)

Add transport fields to `Upstream` proto for HTTPS backends.

```protobuf
message Upstream {
  // ... existing fields ...

  // Transport configuration
  bool    tls_insecure_skip_verify = 7;  // skip TLS verification to upstream
  string  tls_server_name          = 8;  // override SNI for upstream TLS
}
```

And service-level transport settings:

```protobuf
message Service {
  // ... existing fields ...

  // Connection pool settings
  int32  max_conns_per_host  = 14;  // max connections per upstream host (0 = unlimited)
  int32  max_idle_conns      = 15;  // max idle connections in pool
  string keepalive_interval  = 16;  // e.g. "30s" — keepalive probe interval
}
```

**Compiler:** In `compileReverseProxy()`, emit `transport.http` block with TLS config, keep-alive, and connection pool settings.

**Tests:**
- `TestCompile_UpstreamTLS` — verify transport.http includes tls block with insecure_skip_verify
- `TestCompile_UpstreamTLS_ServerName` — verify SNI override
- `TestCompile_ConnectionPool` — verify keep_alive and max_conns settings in transport

### 3.5 Session affinity and additional LB policies

Add new LB policy enum values:

```protobuf
enum LoadBalancingPolicy {
  // ... existing values ...
  LB_POLICY_COOKIE          = 6;
  LB_POLICY_URI_HASH        = 7;
  LB_POLICY_HEADER          = 8;
}

message Service {
  // ... existing fields ...

  // Header-based or cookie-based LB config
  string lb_header_name = 17;  // header name for LB_POLICY_HEADER
  string lb_cookie_name = 18;  // cookie name for LB_POLICY_COOKIE (default: "lb")
}
```

**Compiler:** Map new enum values to Caddy selection policy names. For cookie and header policies, include the relevant config fields.

**Tests:**
- `TestCompile_CookieLBPolicy` — verify cookie selection policy with cookie name
- `TestCompile_URIHashLBPolicy` — verify uri_hash selection policy
- `TestCompile_HeaderLBPolicy` — verify header selection policy with header name

### 3.6 Additional matchers

Add new matcher types to the proto:

```protobuf
message Matcher {
  repeated string        hosts    = 1;
  repeated PathMatcher   paths    = 2;
  repeated string        methods  = 3;
  repeated HeaderMatcher headers  = 4;

  // New matchers
  repeated QueryMatcher  queries  = 5;
  string                 expression = 6;  // CEL expression
  repeated Matcher       not      = 7;    // negation wrapper
}

message QueryMatcher {
  string key   = 1;
  string value = 2;  // empty = match key existence only
}

// Add to HeaderMatcher:
message HeaderMatcher {
  string name   = 1;
  string value  = 2;
  bool   invert = 3;
  bool   regexp = 4;  // treat value as regex
}
```

**Compiler:** Emit `query`, `expression`, `not`, and `header_regexp` matchers in the compiled config.

**Tests:**
- Table-driven tests extending the existing `TestMatcherTypes` pattern:
  - `query matcher` — verify query string matching
  - `expression matcher` — verify CEL expression passthrough
  - `not matcher` — verify negation wrapping
  - `header regexp matcher` — verify header_regexp output

## 4. Workstream 3: Infrastructure (deferred, issues only)

These are tracked as GitHub issues but not implemented in this plan.

- **L4 route config model** — separate route type, L4 matchers, port conflict detection
- **PII log filters** — ip_mask, hash, query, cookie from rioku.yaml
- **Cert storage config** — Redis/Valkey module in compiled Caddy JSON
- **Named route optimization** — deduplicate shared policy handler chains
- **Event subscriptions** — cert lifecycle events to audit log
- **Header manipulation via policies** — compile POLICY_TYPE_TRANSFORM to Caddy headers handler
- **handle_response for error handling** — intercept upstream responses by status

## 5. Coordination with TrafficService Plan

The traffic service plan (other Claude instance) is implementing:
- rioku_vars handler injection in compiler (already there)
- Log format config with unixgram socket writer
- Log ingester with `ParseLogLine` (currently uses `uuid.New()`)
- Ring buffer, aggregator, TraceStore, gRPC service

**Overlap points:**
- **Handler chain order** — traffic service adds rioku_vars at position 0. This plan inserts tracing at position 0, pushing rioku_vars to position 1. One edit to `compileHandlerChain()`.
- **Log format fields** — traffic service configures log extra fields. This plan adds `trace_id` and `span_id` to those fields. One edit to the log config builder.
- **Ingester trace_id** — traffic service generates `uuid.New()`. This plan changes it to read `trace_id` from the log JSON. One edit to `ParseLogLine`.

**Strategy:** Execute this plan after the traffic service branch merges. The three overlap points are surgical edits that build on top of the traffic service's code, not conflicts with it.

## 6. Testing Strategy

All tests follow existing patterns in the codebase:

- **Compiler tests** (`compiler_test.go`): Table-driven where possible, using the `dig()` helper to navigate compiled JSON. Each new feature gets at least 2 tests (feature present + feature absent/defaults).
- **Ingester tests** (`ingester_test.go`): Unit tests for `ParseLogLine` with JSON fixtures. Test both with and without trace_id field for backwards compatibility.
- **Ask endpoint tests**: Standard `net/http/httptest` handler tests. Table-driven for domain matching scenarios (exact, wildcard, missing, disabled).
- **Sandbox smoke tests**: For streaming (SSE proxy), trusted proxies (X-Forwarded-For), and metrics (/metrics scraping). These validate the compiled config actually works in Caddy, not just that the JSON looks right.
- **Proto contract tests**: After proto changes, verify that the generated Go code compiles and that new fields round-trip through JSON marshaling.

**All tests run with `-race` per project convention.**
