# Error Envelope Contract (RFC 7807 Problem Details)

> Status: stable. All Rioku REST endpoints return errors as RFC 7807 problem JSON. The SPA's
> `customFetch` mutator parses this shape into typed `ApiError` subclasses (see
> `packages/web/src/api/errors.ts`).

## Content type

`application/problem+json` for every error response (4xx and 5xx). 2xx success responses use
`application/json`.

## Shape

The envelope follows RFC 7807 with two Rioku extensions (`errors` and `instance`):

```json
{
  "type": "https://rioku.dev/errors/<short-slug>",
  "title": "Human-readable category",
  "status": 422,
  "detail": "Specific message for this occurrence",
  "instance": "/api/v1/t/acme/services",
  "errors": [
    { "field": "name", "reason": "required", "value": null }
  ]
}
```

| Field     | Type              | Required         | Notes |
|-----------|-------------------|------------------|-------|
| `type`    | URI string        | yes              | Stable, dereferenceable URI under `https://rioku.dev/errors/`. SPA error class is selected by mapping this URI. |
| `title`   | string            | yes              | Short, category-level summary. Stable across occurrences for the same `type`. |
| `status`  | integer           | yes              | Mirrors HTTP status code. |
| `detail`  | string            | yes              | Specific to this occurrence. May include input values; never includes secrets, stack traces, or internal hostnames. |
| `instance` | string           | yes              | Request path (without origin). |
| `errors`  | ValidationError[] | yes for 400/422  | Field-level errors for client display. Empty array or omitted for non-validation errors. |

Additional headers on every problem response:

- `X-Request-ID` — propagated from request, generated as `req_<8 hex>` if absent. Surfaced in SPA
  logs and audit entries.
- `X-Correlation-ID` — set by the auth middleware on authenticated requests; mirrors the session
  correlation token. The SPA's `customFetch` captures this onto thrown errors as
  `error.correlationId`.

## Implementation

`writeProblem` in `packages/daemon/internal/gateway/auth_routes.go` is the canonical helper:

```go
func writeProblem(w http.ResponseWriter, status int, errType, title, detail, instance string, errs []ValidationError)
```

The gRPC-gateway path uses `ErrorHandler` in `errors.go`, which maps gRPC status codes to HTTP
status and problem type before calling the same `ProblemDetail` struct.

## Type URI catalog

The daemon emits these `type` values. Sourced from `errType*` constants in
`packages/daemon/internal/gateway/errors.go` and all `writeProblem` call sites.

| Type URI | HTTP status | Title | When emitted |
|----------|-------------|-------|--------------|
| `https://rioku.dev/errors/validation-failed` | 400, 422 | Validation failed | Schema or field-level errors; also maps from gRPC `InvalidArgument` |
| `https://rioku.dev/errors/unauthenticated` | 401 | Authentication required | Missing or expired session; maps from gRPC `Unauthenticated` |
| `https://rioku.dev/errors/forbidden` | 403 | Permission denied | RBAC denial; maps from gRPC `PermissionDenied` |
| `https://rioku.dev/errors/not-found` | 404 | Resource not found | Lookup miss (including cross-tenant); maps from gRPC `NotFound` |
| `https://rioku.dev/errors/version-conflict` | 409 | Resource conflict / Precondition failed | Optimistic concurrency check; maps from gRPC `AlreadyExists` and `FailedPrecondition` |
| `https://rioku.dev/errors/unprocessable` | 422 | Unprocessable entity | Business-rule violation (emitted directly via `writeProblem`) |
| `https://rioku.dev/errors/rate-limited` | 429 | Rate limit exceeded | Caller-side or tenant rate limiting; maps from gRPC `ResourceExhausted` |
| `https://rioku.dev/errors/internal` | 500 | Internal server error | Unexpected failures (message sanitized — reference ID only); maps from gRPC `Internal` |
| `https://rioku.dev/errors/unavailable` | 503 | Service unavailable | Caddy/upstream not ready; maps from gRPC `Unavailable` |
| `https://rioku.dev/errors/bad-gateway` | 502 | Bad gateway | Upstream returned non-conforming response |
| `https://rioku.dev/errors/gateway-timeout` | 504 | Gateway timeout | Caddy/upstream timeout; maps from gRPC `DeadlineExceeded` |
| `https://rioku.dev/errors/account-locked` | 423 | Account locked | After repeated auth failures |
| `https://rioku.dev/errors/not-implemented` | 501 | Not implemented | Stubbed endpoints (e.g., PromQL proxy prior to Plan 8) |

The `type` URI is canonical: do **not** key SPA logic on `title` or `detail` (those may change for
clarity). Only `type` is stable.

## Special-case headers

- **401** responses MUST include `WWW-Authenticate: Bearer`. The `writeProblem` helper and
  `ErrorHandler` both enforce this automatically.
- **429** and **503** responses include `Retry-After: 5` (seconds). `ErrorHandler` sets this; direct
  `writeProblem` callers are responsible for setting it themselves when applicable.

## Validation errors (`errors[]`)

For 400/422 responses with field-level detail, the `errors` array carries:

```json
{
  "field": "email",
  "reason": "format",
  "value": "not-an-email"
}
```

| Field    | Notes |
|----------|-------|
| `field`  | Dot-path into the request body. Use `[i]` for array indices. |
| `reason` | One of: `required`, `format`, `range`, `enum`, `unique`, `pattern`, `length`. SPA may surface the reason key directly. |
| `value`  | Optional; omitted for sensitive inputs (passwords, secrets). |

Defined in Go as `ValidationError` in `errors.go`:

```go
type ValidationError struct {
    Field  string `json:"field"`
    Reason string `json:"reason"`
    Value  any    `json:"value,omitempty"`
}
```

## SPA error class mapping

`packages/web/src/api/errors.ts` defines:

| `type` URI | SPA class |
|------------|-----------|
| `…/unauthenticated` | `AuthFailureError` |
| `…/forbidden` | `PermissionError` |
| `…/validation-failed`, `…/unprocessable` | `ValidationError` |
| Status 5xx (any type) | `ServerError` |
| Network / non-HTTP failure | `NetworkError` |
| Otherwise | base `ApiError` |

The mutator (`customFetch`) reads the response body, applies the mapping above, and throws the typed
error. React Query / TanStack Query consumers can `instanceof`-check.

`correlationId` from the `X-Correlation-ID` response header is attached to every thrown error for
log tracing.

## 4xx vs 5xx audit emission

- **4xx** errors are **not** audited (caller mistakes are not security events).
- **5xx** errors emit a structured `slog.Error` entry at `error` level with the request ID, path,
  and a sanitized message. Internal stack traces never enter the audit log.

The 5xx `detail` field sent to the client is always `"An unexpected error occurred. Reference: <request-id>"` — never the raw error string.

## Examples

### 422 — validation

```http
POST /api/v1/t/acme/services
Content-Type: application/json

{ "name": "" }

HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json
X-Request-ID: req_a1b2c3d4

{
  "type": "https://rioku.dev/errors/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "name: required",
  "instance": "/api/v1/t/acme/services",
  "errors": [{ "field": "name", "reason": "required" }]
}
```

### 401 — unauthenticated

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/problem+json
WWW-Authenticate: Bearer
X-Request-ID: req_b2c3d4e5

{
  "type": "https://rioku.dev/errors/unauthenticated",
  "title": "Authentication required",
  "status": 401,
  "detail": "session expired or not present",
  "instance": "/api/v1/t/acme/routes"
}
```

### 500 — internal (sanitized)

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json
X-Request-ID: req_c3d4e5f6

{
  "type": "https://rioku.dev/errors/internal",
  "title": "Internal server error",
  "status": 500,
  "detail": "An unexpected error occurred. Reference: req_c3d4e5f6",
  "instance": "/api/v1/t/acme/services/svc-abc123"
}
```

### 501 — not implemented (PromQL stub)

```http
HTTP/1.1 501 Not Implemented
Content-Type: application/problem+json

{
  "type": "https://rioku.dev/errors/not-implemented",
  "title": "PromQL proxy not yet implemented",
  "status": 501,
  "detail": "This endpoint will be implemented in Plan 8 (Dashboards).",
  "instance": "/api/v1/t/acme/promql/query"
}
```

## Stability

The catalog above is stable for v1. New `type` URIs may be added; existing ones do not change
semantics. Removing a type or changing an existing URI is a breaking change and requires a v2
contract.
