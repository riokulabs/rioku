---
title: Request Lifecycle
description: How an HTTP request flows through the middleware stack in the REST gateway
sidebar_position: 2
---

All REST requests to the daemon enter through a single `net/http` handler chain built in `internal/gateway/gateway.go`. Middleware is applied outermost-first; the comment in the source describes the ordering explicitly.

```mermaid
sequenceDiagram
    participant C as Client
    participant RI as RequestID middleware
    participant AU as Auth middleware
    participant TN as Tenant middleware
    participant RL as RateLimit middleware
    participant CO as CORS middleware
    participant SH as SecurityHeaders middleware
    participant MX as http.ServeMux (routes)
    participant UP as Upstream / handler

    C->>RI: HTTP request
    note over RI: injects X-Request-ID if absent
    RI->>AU: request + request-id
    note over AU: cookie (rioku_sid) then Bearer token<br/>writes 401 on unauthenticated API paths<br/>attaches Claims to context
    AU->>TN: request + claims
    note over TN: extracts {tenant} slug from<br/>/api/v1/t/{tenant}/...<br/>resolves against store; attaches Tenant to context<br/>passes non-tenant paths through untouched
    TN->>RL: request + tenant
    note over RL: sliding-window per user/session/IP<br/>writes 429 + Retry-After on breach
    RL->>CO: request
    note over CO: handles OPTIONS preflight<br/>sets CORS headers on all responses
    CO->>SH: request
    note over SH: X-Content-Type-Options, X-Frame-Options,<br/>CSP (api: default-src 'none')
    SH->>MX: request
    note over MX: route match; AI routes / audit / SSE /<br/>grpc-gateway / SPA served here
    MX->>UP: dispatched
    UP-->>MX: response
    MX-->>SH: response
    SH-->>CO: response
    CO-->>RL: response
    RL-->>TN: response
    TN-->>AU: response
    AU-->>RI: response
    RI-->>C: final response
```

**Middleware details:**

| Layer | Package | Notes |
|---|---|---|
| RequestID | `internal/gateway` | Generates or forwards `X-Request-ID`; always runs |
| Auth | `internal/gateway/auth_middleware.go` | Cookie-first (`rioku_sid`), Bearer fallback; skips auth-bootstrap paths |
| Tenant | `internal/gateway/tenant_middleware.go` | Only active on `/api/v1/t/{tenant}/...`; other paths pass through |
| RateLimit | `internal/gateway/ratelimit_middleware.go` | In-memory sliding window; keyed by user ID > session ID > IP |
| CORS | `internal/gateway/security_middleware.go` | Handles preflight before the actual handler fires |
| SecurityHeaders | `internal/gateway/security_middleware.go` | Innermost; writes response headers closest to wire |

**Audit emission** is not a middleware layer — it is a side-effect in individual route handlers after a mutation succeeds. Audit records are written to the store and emitted via SSE on the `/api/v1/t/{tenant}/audit/stream` endpoint.

**AI routing** goes through the same stack. After the mux dispatches to `RegisterAIRoutes`, the `internal/aigateway` package handles provider selection, per-agent rate limits, and trace recording.

**Source files:**
- `packages/daemon/internal/gateway/gateway.go` — middleware chain assembly (lines ~306-319)
- `packages/daemon/internal/gateway/auth_middleware.go` — auth logic
- `packages/daemon/internal/gateway/tenant_middleware.go` — tenant resolution
- `packages/daemon/internal/gateway/ratelimit_middleware.go` — rate limiter
- `packages/daemon/internal/gateway/security_middleware.go` — security + CORS headers
