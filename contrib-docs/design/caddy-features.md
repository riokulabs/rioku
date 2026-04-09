# Rioku — Caddy Feature Inventory & Integration Strategy

**Version:** 1.0
**Date:** 2026-04-09
**Status:** Reference document

This document inventories every Caddy feature relevant to Rioku and documents the integration strategy: delegate to Caddy, build in Rioku, or both.

---

## 1. HTTP Handlers

### Critical for API Gateway (expose to users)

| Handler | Module ID | Rioku Integration |
|---|---|---|
| **reverse_proxy** | `http.handlers.reverse_proxy` | Core of every route. Expose via Route/Service config. Already in compiler. |
| **rewrite** | `http.handlers.rewrite` | URI/path rewrite. Expose via POLICY_TYPE_TRANSFORM. |
| **uri** | `http.handlers.uri` | Strip/add path prefix, query manipulation. Expose via Transform policy. |
| **headers** | `http.handlers.headers` | Add/set/delete request and response headers. Expose via Transform policy. Internal use for X-Request-ID injection. |
| **encode** | `http.handlers.encode` | gzip/zstd compression. Expose as per-route or global policy. |
| **request_body** | `http.handlers.request_body` | Max body size limits. Critical for LLM proxy payloads. Expose via policy. |
| **tracing** | `http.handlers.tracing` | OpenTelemetry span creation. Inject at top of every route chain. |
| **map** | `http.handlers.map` | Variable mapping (switch/case on request attributes). Expose for advanced routing. |
| **intercept** | `http.handlers.intercept` | Intercept responses by status code for custom error handling. Expose via error handling policy. |

### Internal Use Only

| Handler | Module ID | Purpose |
|---|---|---|
| **subroute** | `http.handlers.subroute` | Groups handlers with isolated matcher evaluation. Used by compiler for policy chains. |
| **vars** | `http.handlers.vars` | Set placeholder variables. Extended by rioku-vars plugin. |
| **authentication** | `http.handlers.authentication` | Pluggable auth framework. auth-jwt/auth-apikey register as providers. |
| **file_server** | `http.handlers.file_server` | Admin panel SPA serving only. |
| **respond** | `http.handlers.respond` | Health probe responses, maintenance pages. |
| **metrics** | `http.handlers.metrics` | Prometheus endpoint handler. |
| **error** | `http.handlers.error` | Controlled error injection for error handling chains. |
| **abort** | `http.handlers.abort` | Drop connection immediately. Used by IP block lists. |

### Skip (not relevant for API gateway)

- `templates` — server-side rendering
- `push` — HTTP/2 push (deprecated in browsers)
- `acme_server` — ACME CA server (Rioku has its own PKI)

---

## 2. Request Matchers

### Implemented in Compiler

| Matcher | Module ID | Proto Field |
|---|---|---|
| **host** | `http.matchers.host` | `Matcher.hosts` |
| **path** | `http.matchers.path` | `PathMatcher` (PREFIX/EXACT) |
| **path_regexp** | `http.matchers.path_regexp` | `PathMatcher` (REGEXP) |
| **method** | `http.matchers.method` | `Matcher.methods` |
| **header** | `http.matchers.header` | `HeaderMatcher` with invert |

### Not Yet in Proto (should add)

| Matcher | Module ID | Recommended Proto Addition |
|---|---|---|
| **header_regexp** | `http.matchers.header_regexp` | Add TYPE_REGEXP to HeaderMatcher |
| **query** | `http.matchers.query` | Add QueryMatcher to Matcher |
| **expression** | `http.matchers.expression` | Add as advanced/expert matcher type (CEL) |
| **not** | `http.matchers.not` | Add as matcher wrapper for exclusion patterns |
| **remote_ip** / **client_ip** | `http.matchers.client_ip` | Maps to ip-filter config-layer plugin |
| **protocol** | `http.matchers.protocol` | Add as advanced matcher option (HTTP/1.1, H2, H3) |

### Internal Only

- **vars** / **vars_regexp** — match on rioku-vars placeholder values
- **file** — admin SPA file serving

---

## 3. Reverse Proxy Deep Features

### Implemented

| Feature | Status |
|---|---|
| Load balancing (round_robin, random, least_conn, ip_hash, weighted_round_robin) | In compiler |
| Active health checks (path, interval, timeout, thresholds, expected_statuses) | In compiler |
| WebSocket proxying | Automatic, no config needed |

### Not Yet Implemented (should add to compiler)

| Feature | Caddy JSON Path | Priority | Notes |
|---|---|---|---|
| **Passive health checks** | `health_checks.passive.*` | High | `fail_duration`, `max_fails`, `unhealthy_request_count`, `unhealthy_status`, `unhealthy_latency`. Add to HealthCheck proto. |
| **Retries** | `load_balancing.retries`, `retry_match` | High | Retry count + which responses trigger retry. Add to Service proto. |
| **Timeouts** | `flush_interval`, `transport.dial_timeout`, `response_header_timeout` | Critical | Essential for LLM proxy — streaming needs `flush_interval: -1`. Add to Service proto. |
| **Transport config** | `transport.*` | High | TLS to upstream, HTTP/2, keep-alive, max_conns_per_host. Add to Upstream proto. |
| **trusted_proxies** | Server-level `trusted_proxies` | Critical | Replaces realip plugin. Compile from `rioku.yaml`. |
| **Header manipulation** | `headers.request.*`, `headers.response.*` | High | Proxy-specific header set/add/delete/replace. Compile from POLICY_TYPE_TRANSFORM. |
| **handle_response** | `handle_response` | High | Intercept upstream responses by status code. Enables custom error handling and response rewriting. |
| **Streaming/SSE** | `flush_interval: -1` | Critical | Must set for SSE and LLM streaming responses. |
| **Buffer responses** | `buffer_responses`, `max_buffer_size` | Medium | Required for response transformation. |
| **Session affinity** | `load_balancing.selection_policy: cookie` | Medium | Add `LB_POLICY_COOKIE` to LoadBalancingPolicy enum. |
| **Dynamic upstreams** | `dynamic_upstreams` | Medium | SRV/A record DNS discovery. Useful for K8s/Consul. |
| **URI hash LB** | `load_balancing.selection_policy: uri_hash` | Low | Add `LB_POLICY_URI_HASH` to enum. |

---

## 4. TLS & Certificate Management

### Automatic HTTPS

Caddy obtains and renews TLS certificates automatically via ACME (Let's Encrypt primary, ZeroSSL fallback).

**Challenge types:**
- **HTTP-01** — port 80 must be reachable. Simplest.
- **TLS-ALPN-01** — port 443 only. Fallback if HTTP-01 fails.
- **DNS-01** — DNS TXT record. Required for wildcard certs. Uses DNS provider plugins (Cloudflare bundled by default).

**Rioku integration:** Users configure domains on routes. The config compiler generates automation policies. Rioku must ensure ports 80/443 are available to Caddy for challenges.

### On-Demand TLS

Caddy obtains certs during TLS handshake for unknown SNI values. Critical for multi-tenant gateway.

**Rioku must implement the `ask` endpoint** — a localhost-only HTTP handler that queries the route/service table to validate domain ownership before allowing cert issuance. Without this, attackers can trigger issuance for arbitrary domains. The endpoint must be fast (constant-time DB lookup).

**Gotcha:** Wildcard certs and on-demand TLS are mutually exclusive.

### TLS Configuration (expose to users)

| Feature | Exposure |
|---|---|
| Protocol min/max (TLS 1.2/1.3) | Per-route/per-service |
| Client auth (mTLS) | Per-route — `mode`, `trust_pool` |
| OCSP stapling | Automatic, no config needed |
| HTTP-to-HTTPS redirects | Per-route toggle (`force_https`) |
| Cipher suite customization | Expose but default to Caddy's secure defaults |

### Automation Policies

The compiler must sort policies by specificity: **specific domains > wildcards > on-demand catch-all**. Two policies matching the same domain silently breaks the second one.

### Certificate Storage

For multi-node Rioku: configure Caddy to use Redis/Valkey storage so nodes share certs and coordinate ACME via distributed locks. Natural fit with Rioku's optional Valkey dependency. Needs key namespace isolation.

**Key boundary:** Rioku's internal PKI (node-to-node, Caddy admin, DB certs) and Caddy's cert management (public-facing TLS) are completely separate systems — different CAs, different storage, different config.

---

## 5. Admin API & Config System

### Admin API Endpoints (internal use only)

| Endpoint | Method | Purpose |
|---|---|---|
| `/config/[path]` | GET/POST/PUT/PATCH/DELETE | CRUD on any config node |
| `/id/{id}` | GET/POST/PUT/PATCH/DELETE | Access by `@id` tag (stable references) |
| `/load` | POST | Full config replace |
| `/stop` | POST | Graceful shutdown |
| `/reverse_proxy/upstreams` | GET | Upstream health status |
| `/pki/ca/<id>/certificates` | GET | CA certificate chain |
| `/metrics` | GET | Prometheus metrics |

**Rioku strategy:**
- Bind Caddy admin to loopback only (already implemented)
- Use `@id` on compiled objects for stable references
- Use `ETag`/`If-Match` for safe concurrent config pushes
- Poll `/reverse_proxy/upstreams` for health dashboard
- Use path-based PATCH for surgical updates as config grows
- Caddy auto-rolls back on invalid config — Rioku should log and surface these errors

### Named Routes (internal optimization)

When a policy is attached to multiple routes, the compiler should emit a named route and reference it. Reduces config size and ensures policy changes apply everywhere atomically.

### Events (cert lifecycle)

Subscribe to `cert_obtained`, `cert_renewed`, `cert_failed` events. Update Rioku's audit log and emit ClusterEvent for admin panel visibility. Consider a custom Caddy event handler module that sends events via Unix socket.

---

## 6. Logging & Observability

### Access Logging (delegate to Caddy)

Already implemented — compiler sends access logs to a unixgram socket for TraceStore ingestion.

**Improvements to make:**
1. Add `{http.vars.trace_id}` and `{http.vars.span_id}` to log extra fields
2. Replace `uuid.New()` in `ParseLogLine` with Caddy's trace_id
3. Expose PII log filter config through `rioku.yaml` → compile into Caddy's encoder fields

**PII log filters available:**
- `ip_mask` — mask IPv4/IPv6 addresses (GDPR)
- `delete` — remove field entirely
- `hash` — SHA-256 pseudonymization (preserves correlation)
- `query` — redact query parameters
- `cookie` — redact cookie values
- `regexp` — regex-based redaction
- `replace` — static replacement

### Prometheus Metrics (delegate to Caddy)

Enable `"metrics": {}` on all compiled server blocks. Key metrics:

| Metric | Type | Value |
|---|---|---|
| `caddy_http_requests_total` | Counter | Total requests by method/code |
| `caddy_http_request_duration_seconds` | Histogram | Round-trip latency |
| `caddy_http_response_size_bytes` | Histogram | Response size |
| `caddy_reverse_proxy_upstreams_healthy` | Gauge | Upstream health count |
| `caddy_http_requests_in_flight` | Gauge | Active connections |

### OpenTelemetry Tracing (both)

Inject `tracing` handler at top of every route chain. Caddy creates spans with W3C traceparent propagation, exports via OTLP/gRPC. Span attributes: method, route, status_code, url, host.

Rioku's TraceStore should consume trace/span IDs from access logs for end-to-end correlation with upstream OTEL traces.

### Log Sampling

Configurable: first N entries per interval, then 1-in-M. Expose through `rioku.yaml` for high-traffic deployments.

---

## 7. Layer 4 Proxying (caddy-l4)

### Supported Protocol Matchers

| Matcher | Protocols |
|---|---|
| `tls` | TLS ClientHello: SNI hostname, ALPN, version, cipher suites |
| `http` | HTTP/1.x and HTTP/2: host, method, path, headers |
| `ssh` | SSH protocol banner |
| `postgres` | PostgreSQL startup message |
| `dns` | DNS query packets |
| `rdp` | RDP handshake |
| `socks` | SOCKS4/SOCKS5 |
| `openvpn` | OpenVPN handshake |
| `xmpp` | XMPP stream |
| `quic` | QUIC Initial packet |
| `wireguard` | WireGuard handshake |
| `winbox` | MikroTik WinBox |
| `proxy_protocol` | HAProxy PROXY protocol v1/v2 |
| `regexp` | Regex on raw bytes |
| `remote_ip` | Client source IP/CIDR |

### L4 Handlers

| Handler | Purpose |
|---|---|
| **proxy** | TCP/UDP forwarding with load balancing, health checks, PROXY protocol send |
| **tls** | TLS termination using Caddy's cert management |
| **proxy_protocol** | Parse incoming PROXY protocol, expose real client IP |
| **subroute** | Nested route evaluation (post-TLS-termination matching) |
| **throttle** | Bandwidth throttling |

### Key Capabilities

- **Protocol multiplexing:** Multiple protocols on a single port via byte-prefix inspection
- **TLS passthrough:** SNI-based routing without termination (end-to-end encryption)
- **Load balancing:** Same policies as HTTP reverse_proxy (round_robin, least_conn, etc.)
- **Health checks:** Both active and passive supported

### Critical Architecture Consideration

**`layer4` and `http` apps cannot share a listener on the same address:port.** When both coexist on the same port, Rioku must generate a `layer4` server that owns the port and routes HTTP-detected traffic to Caddy's HTTP app (or to localhost on an internal port). The config compiler must:

1. Detect L4 + HTTP port conflicts
2. Generate the multiplexing wrapper automatically
3. Handle HTTP/3 (QUIC) conflicts — disable H3 when L4 owns UDP/443, or route QUIC through L4

### Rioku Config Model for L4

- Separate route type (`kind: l4` vs `kind: http`) in config store
- L4 routes bind to listeners; HTTP routes bind to virtual hosts
- `matching_timeout` exposed as tunable (default 3s)
- UDP features gated behind explicit opt-in (known edge cases)
- Route priority control (first match wins)

---

## 8. Performance Features (delegate to Caddy)

| Feature | Status | Notes |
|---|---|---|
| HTTP/2 | Enabled by default on TLS | No config needed |
| HTTP/3 (QUIC) | Enabled by default since v2.6 | Disable per-server with `"protocols": ["h1", "h2"]` |
| Connection pooling | Automatic in reverse_proxy | Configurable: keep_alive, max_idle_conns |
| Server timeouts | Configurable per-server | `read_timeout`, `write_timeout`, `idle_timeout` |
| Max header size | `max_header_bytes` | Default 1MB |

Expose timeout and buffer configuration in Service proto. Delegate protocol negotiation and connection pooling entirely to Caddy.

---

## 9. Placeholders

### Native Caddy Placeholders (always available)

- `{http.request.method}`, `{http.request.host}`, `{http.request.uri}`, `{http.request.uri.path}`, `{http.request.uri.query}`
- `{http.request.header.*}`, `{http.request.cookie.*}`
- `{http.request.remote.host}`, `{client_ip}` (respects trusted_proxies)
- `{http.request.uuid}` — UUID v4 per request
- `{http.request.tls.version}`, `{http.request.tls.cipher_suite}`, `{http.request.tls.server_name}`
- `{http.reverse_proxy.upstream.address}`, `{http.reverse_proxy.duration}`, `{http.reverse_proxy.status_code}`
- `{http.vars.trace_id}`, `{http.vars.span_id}` (when tracing handler active)

### Rioku-Specific Placeholders (via rioku-vars plugin)

Currently: `{http.vars.rioku_route_id}`, `{http.vars.rioku_service_id}`

Should add as auth/policy plugins are built:
- `{http.vars.rioku_actor_id}`
- `{http.vars.rioku_session_id}`
- `{http.vars.rioku_policy_ids}`

All flow into access logs automatically.

### CEL Expressions

The `expression` matcher uses CEL for complex routing. Available functions: `matches(regex)`, `contains()`, `startsWith()`, `inCIDR()`, `path()`, `pathRegexp()`, `header()`. Rioku should use CEL as the compilation target when policies need conditional logic.

---

## 10. Compiler Gap Summary

Features Caddy provides that the config compiler does not yet generate:

### Critical (blocks key use cases)

1. **Timeouts** — `flush_interval: -1` for streaming/LLM, `dial_timeout`, `response_header_timeout`
2. **trusted_proxies** — required for correct client IP behind LBs
3. **tracing handler injection** — enables OTEL correlation
4. **On-demand TLS ask endpoint** — enables multi-tenant cert provisioning

### High Priority

5. **Passive health checks** — `fail_duration`, `max_fails`, `unhealthy_latency`
6. **Retries** — retry count and retry conditions
7. **Transport config** — TLS to upstream, HTTP/2, keep-alive
8. **Header manipulation** — proxy-level set/add/delete/replace
9. **handle_response** — response interception by status code
10. **Prometheus metrics** — `"metrics": {}` on server blocks

### Medium Priority

11. **Session affinity** (cookie LB policy)
12. **Query and expression matchers** — add to Matcher proto
13. **Compression config** — encode handler with min_length, content-type filtering
14. **Named routes** — compiler optimization for shared policies
15. **PII log filters** — ip_mask, hash, query, cookie redaction
16. **L4 route generation** — separate config path for layer4 app
17. **Dynamic upstreams** — SRV/A record DNS discovery
18. **Cert storage config** — Redis/Valkey for multi-node
19. **Event subscriptions** — cert lifecycle audit logging
