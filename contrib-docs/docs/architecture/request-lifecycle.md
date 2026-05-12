---
title: Request Lifecycle
description: How an HTTP request flows through the middleware stack in the REST gateway
sidebar_position: 2
---

All REST requests to the daemon enter through a single `net/http` handler chain built in `internal/gateway/gateway.go`. Middleware is applied outermost-first; the comment in the source describes the ordering explicitly.

```mermaid
sequenceDiagram
    participant C as Client
    participant RI as RequestID
    participant AU as Auth
    participant TN as Tenant
    participant RL as RateLimit
    participant CO as CORS
    participant SH as SecurityHeaders
    participant MX as ServeMux
    participant UP as Handler

    C->>RI: HTTP request
    Note over RI: inject X-Request-ID if absent
    RI->>AU: forward
    Note over AU: cookie rioku_sid, then Bearer<br/>401 on unauthenticated API paths<br/>attach Claims to context
    AU->>TN: forward
    Note over TN: extract tenant slug from URL<br/>resolve via store, attach to context<br/>non-tenant paths pass through
    TN->>RL: forward
    Note over RL: sliding window per user / session / IP<br/>429 + Retry-After on breach
    RL->>CO: forward
    Note over CO: preflight OPTIONS short-circuit<br/>CORS headers on all responses
    CO->>SH: forward
    Note over SH: X-Content-Type-Options, X-Frame-Options<br/>CSP default-src none for API paths
    SH->>MX: forward
    Note over MX: route match: AI, audit, SSE,<br/>grpc-gateway, SPA
    MX->>UP: dispatch
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
| --- | --- | --- |
| RequestID | `internal/gateway` | Generates or forwards `X-Request-ID`; always runs |
| Auth | `internal/gateway/auth_middleware.go` | Cookie-first (`rioku_sid`), Bearer fallback; skips auth-bootstrap paths |
| Tenant | `internal/gateway/tenant_middleware.go` | Only active on `/api/v1/t/{tenant}/...`; other paths pass through |
| RateLimit | `internal/gateway/ratelimit_middleware.go` | In-memory sliding window; keyed by user ID > session ID > IP |
| CORS | `internal/gateway/security_middleware.go` | Handles preflight before the actual handler fires |
| SecurityHeaders | `internal/gateway/security_middleware.go` | Innermost; writes response headers closest to wire |

**Audit emission** is not a middleware layer; it is a side-effect in individual route handlers after a mutation succeeds. Audit records are written to the store and emitted via SSE on the `/api/v1/t/{tenant}/audit/stream` endpoint.

**AI routing** goes through the same stack. After the mux dispatches to `RegisterAIRoutes`, the `internal/aigateway` package handles provider selection, per-agent rate limits, and trace recording.

**Source files:**

- `packages/daemon/internal/gateway/gateway.go`: middleware chain assembly (lines ~306-319)
- `packages/daemon/internal/gateway/auth_middleware.go`: auth logic
- `packages/daemon/internal/gateway/tenant_middleware.go`: tenant resolution
- `packages/daemon/internal/gateway/ratelimit_middleware.go`: rate limiter
- `packages/daemon/internal/gateway/security_middleware.go`: security + CORS headers
