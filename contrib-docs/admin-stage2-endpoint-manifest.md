# Stage-2 Admin Endpoint Manifest

> Updated by every parallel plan as it lands work. Plan 13 close-out asserts every entry is `EXISTS`
> (or explicitly classified as out-of-scope).

> **Source of truth**: `packages/daemon/internal/gateway/api.full.json` (OAS 3.0.3) plus
> registered `mux.Handle` patterns in `packages/daemon/internal/gateway/`. When either changes,
> re-run the manifest classification script.

## Status values

| Status | Meaning |
|--------|---------|
| `EXISTS` | Route handler registered; key behavior and tests present. |
| `EXISTS-INCOMPLETE` | Handler registered but stubbed, partial, or missing critical behavior. |
| `NEW` | Not yet implemented; the owning plan adds it. |

## Summary (as of Plan 00c)

| Feature area | Endpoints | EXISTS | EXISTS-INCOMPLETE | NEW |
|---|---|---|---|---|
| Auth | 14 | 14 | 0 | 0 |
| Identity (users, memberships, sessions) | 13 | 13 | 0 | 0 |
| API keys | 7 | 7 | 0 | 0 |
| Services | 8 | 8 | 0 | 0 |
| Routes | 9 | 9 | 0 | 0 |
| Sites | 7 | 7 | 0 | 0 |
| Middlewares | 5 | 5 | 0 | 0 |
| AI (providers, agents, tools, MCP, traces, rate-limits, tool-bindings) | 55 | 55 | 0 | 0 |
| Dashboards + widgets | 29 | 29 | 0 | 0 |
| Audit | 11 | 11 | 0 | 0 |
| Notifications | 14 | 14 | 0 | 0 |
| Plugins + plugin-signers | 17 | 15 | 2 | 0 |
| Cluster | 11 | 11 | 0 | 0 |
| Settings | 33 | 33 | 0 | 0 |
| RBAC | 7 | 7 | 0 | 0 |
| Access policies | 8 | 8 | 0 | 0 |
| PKI / certificates | 10 | 10 | 0 | 0 |
| Traffic / observability | 9 | 9 | 0 | 0 |
| Admin (super-admin) | 11 | 11 | 0 | 0 |
| Keys (signing / PKI) | 4 | 4 | 0 | 0 |
| Infrastructure (health, openapi, events, JWKS) | 7 | 6 | 1 | 0 |
| Opaque handles | 2 | 2 | 0 | 0 |
| Metrics (PromQL proxy) | 1 | 0 | 1 | 0 |
| **Total** | **292** | **288** | **4** | **0** |

> Note: The OpenAPI spec (`api.full.json`) enumerates 102 paths × verbs. The daemon registers
> 318 route patterns (including sub-resources, SSE streams, and admin-panel extras not in the
> published OAS). This manifest covers the superset from actual `mux.Handle` registrations.

---

## Auth

Source: `packages/daemon/internal/gateway/auth_routes.go`, `totp_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| POST | `/api/v1/auth/login` | EXISTS | `auth_routes.go` |
| POST | `/api/v1/auth/logout` | EXISTS | `auth_routes.go` |
| POST | `/api/v1/auth/refresh` | EXISTS | `auth_routes.go` |
| POST | `/api/v1/auth/token` | EXISTS | `auth_routes.go` |
| POST | `/api/v1/auth/password` | EXISTS | `auth_routes.go` |
| GET  | `/api/v1/auth/me` | EXISTS | `auth_routes.go` |
| PATCH | `/api/v1/auth/me` | EXISTS | `auth_routes.go` |
| GET  | `/api/v1/auth/sessions` | EXISTS | `auth_routes.go` |
| DELETE | `/api/v1/auth/sessions/{id}` | EXISTS | `auth_routes.go` |
| POST | `/api/v1/auth/sessions/revoke-others` | EXISTS | `auth_routes.go` |
| POST | `/api/v1/auth/totp/setup` | EXISTS | `totp_routes.go` |
| POST | `/api/v1/auth/totp/verify` | EXISTS | `totp_routes.go` |
| POST | `/api/v1/auth/totp/disable` | EXISTS | `totp_routes.go` |
| POST | `/api/v1/users/{id}/totp/reset` | EXISTS | `totp_routes.go` |

## Identity — users, memberships, sessions

Source: `user_routes.go`, `tenant_routes.go`, `auth_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/memberships` | EXISTS | `tenant_routes.go` |
| POST | `/api/v1/t/{tenant}/memberships` | EXISTS | `tenant_routes.go` |
| GET  | `/api/v1/t/{tenant}/memberships/{id}` | EXISTS | `tenant_routes.go` |
| PUT  | `/api/v1/t/{tenant}/memberships/{id}` | EXISTS | `tenant_routes.go` |
| PATCH | `/api/v1/t/{tenant}/memberships/{id}` | EXISTS | `tenant_routes.go` |
| DELETE | `/api/v1/t/{tenant}/memberships/{id}` | EXISTS | `tenant_routes.go` |
| PUT  | `/api/v1/t/{tenant}/memberships/{id}/roles` | EXISTS | `tenant_routes.go` |
| POST | `/api/v1/t/{tenant}/memberships/{id}/activate` | EXISTS | `tenant_routes.go` |
| POST | `/api/v1/t/{tenant}/memberships/{id}/deactivate` | EXISTS | `tenant_routes.go` |
| GET  | `/api/v1/t/{tenant}/sessions` | EXISTS | `auth_routes.go` |
| DELETE | `/api/v1/t/{tenant}/sessions/{id}` | EXISTS | `auth_routes.go` |
| POST | `/api/v1/t/{tenant}/sessions/revoke-others` | EXISTS | `auth_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/me` | EXISTS | `settings_routes.go` |

## API keys

Source: `key_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/api-keys` | EXISTS | `key_routes.go` |
| POST | `/api/v1/t/{tenant}/api-keys` | EXISTS | `key_routes.go` |
| GET  | `/api/v1/t/{tenant}/api-keys/{id}` | EXISTS | `key_routes.go` |
| PUT  | `/api/v1/t/{tenant}/api-keys/{id}` | EXISTS | `key_routes.go` |
| PATCH | `/api/v1/t/{tenant}/api-keys/{id}` | EXISTS | `key_routes.go` |
| DELETE | `/api/v1/t/{tenant}/api-keys/{id}` | EXISTS | `key_routes.go` |
| GET  | `/api/v1/t/{tenant}/api-keys/{id}/usage` | EXISTS | `key_routes.go` |
| POST | `/api/v1/t/{tenant}/api-keys/{id}/revoke` | EXISTS | `key_routes.go` |
| POST | `/api/v1/t/{tenant}/api-keys/{id}/rotate` | EXISTS | `key_routes.go` |

## Services

Source: `services_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/services` | EXISTS | `services_routes.go` |
| POST | `/api/v1/t/{tenant}/services` | EXISTS | `services_routes.go` |
| GET  | `/api/v1/t/{tenant}/services/{id}` | EXISTS | `services_routes.go` |
| PUT  | `/api/v1/t/{tenant}/services/{id}` | EXISTS | `services_routes.go` |
| PATCH | `/api/v1/t/{tenant}/services/{id}` | EXISTS | `services_routes.go` |
| DELETE | `/api/v1/t/{tenant}/services/{id}` | EXISTS | `services_routes.go` |
| POST | `/api/v1/t/{tenant}/services/{id}/force-reload` | EXISTS | `services_routes.go` |
| GET  | `/api/v1/t/{tenant}/services/{id}/routes` | EXISTS | `services_routes.go` |

## Routes

Source: `routes_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/routes` | EXISTS | `routes_routes.go` |
| POST | `/api/v1/t/{tenant}/routes` | EXISTS | `routes_routes.go` |
| GET  | `/api/v1/t/{tenant}/routes/{id}` | EXISTS | `routes_routes.go` |
| PUT  | `/api/v1/t/{tenant}/routes/{id}` | EXISTS | `routes_routes.go` |
| PATCH | `/api/v1/t/{tenant}/routes/{id}` | EXISTS | `routes_routes.go` |
| DELETE | `/api/v1/t/{tenant}/routes/{id}` | EXISTS | `routes_routes.go` |
| GET  | `/api/v1/t/{tenant}/routes/{id}/policies` | EXISTS | `routes_routes.go` |
| POST | `/api/v1/t/{tenant}/routes/{id}/policies/{policyId}` | EXISTS | `routes_routes.go` |
| DELETE | `/api/v1/t/{tenant}/routes/{id}/policies/{policyId}` | EXISTS | `routes_routes.go` |

## Sites

Source: `sites_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/sites` | EXISTS | `sites_routes.go` |
| POST | `/api/v1/t/{tenant}/sites` | EXISTS | `sites_routes.go` |
| GET  | `/api/v1/t/{tenant}/sites/{id}` | EXISTS | `sites_routes.go` |
| PUT  | `/api/v1/t/{tenant}/sites/{id}` | EXISTS | `sites_routes.go` |
| PATCH | `/api/v1/t/{tenant}/sites/{id}` | EXISTS | `sites_routes.go` |
| DELETE | `/api/v1/t/{tenant}/sites/{id}` | EXISTS | `sites_routes.go` |
| POST | `/api/v1/t/{tenant}/sites/{id}/toggle` | EXISTS | `sites_routes.go` |
| PATCH | `/api/v1/t/{tenant}/sites/{id}/enabled` | EXISTS | `sites_routes.go` |

## Middlewares

Source: `middleware_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/middlewares` | EXISTS | `middleware_routes.go` |
| POST | `/api/v1/t/{tenant}/middlewares` | EXISTS | `middleware_routes.go` |
| GET  | `/api/v1/t/{tenant}/middlewares/{id}` | EXISTS | `middleware_routes.go` |
| PUT  | `/api/v1/t/{tenant}/middlewares/{id}` | EXISTS | `middleware_routes.go` |
| PATCH | `/api/v1/t/{tenant}/middlewares/{id}` | EXISTS | `middleware_routes.go` |
| DELETE | `/api/v1/t/{tenant}/middlewares/{id}` | EXISTS | `middleware_routes.go` |

## AI

Source: `ai_routes.go`, `ai_providers_routes.go`, `ai_agents_routes.go`, `ai_tools_routes.go`,
`ai_tool_bindings_routes.go`, `ai_mcp_routes.go`, `ai_traces_routes.go`,
`ai_rate_limits_routes.go`, `ai_extra_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/ai/providers` | EXISTS | `ai_providers_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/providers` | EXISTS | `ai_providers_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/providers/{id}` | EXISTS | `ai_providers_routes.go` |
| PUT  | `/api/v1/t/{tenant}/ai/providers/{id}` | EXISTS | `ai_providers_routes.go` |
| PATCH | `/api/v1/t/{tenant}/ai/providers/{id}` | EXISTS | `ai_providers_routes.go` |
| DELETE | `/api/v1/t/{tenant}/ai/providers/{id}` | EXISTS | `ai_providers_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/providers/{id}/test` | EXISTS | `ai_providers_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/providers/{id}/models` | EXISTS | `ai_providers_routes.go` |
| PUT  | `/api/v1/t/{tenant}/ai/providers/{id}/models/{modelId}` | EXISTS | `ai_providers_routes.go` |
| DELETE | `/api/v1/t/{tenant}/ai/providers/{id}/models/{modelId}` | EXISTS | `ai_providers_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/providers/{id}/agents` | EXISTS | `ai_providers_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/agents` | EXISTS | `ai_agents_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/agents` | EXISTS | `ai_agents_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/agents/{id}` | EXISTS | `ai_agents_routes.go` |
| PUT  | `/api/v1/t/{tenant}/ai/agents/{id}` | EXISTS | `ai_agents_routes.go` |
| PATCH | `/api/v1/t/{tenant}/ai/agents/{id}` | EXISTS | `ai_agents_routes.go` |
| DELETE | `/api/v1/t/{tenant}/ai/agents/{id}` | EXISTS | `ai_agents_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/agents/{id}/rotate-credential` | EXISTS | `ai_agents_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/agents/{id}/tools` | EXISTS | `ai_agents_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/agents/{id}/traces` | EXISTS | `ai_agents_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/tools` | EXISTS | `ai_tools_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/tools` | EXISTS | `ai_tools_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/tools/{id}` | EXISTS | `ai_tools_routes.go` |
| PUT  | `/api/v1/t/{tenant}/ai/tools/{id}` | EXISTS | `ai_tools_routes.go` |
| PATCH | `/api/v1/t/{tenant}/ai/tools/{id}` | EXISTS | `ai_tools_routes.go` |
| DELETE | `/api/v1/t/{tenant}/ai/tools/{id}` | EXISTS | `ai_tools_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/tools/{id}/test` | EXISTS | `ai_tools_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/tools/{id}/agents` | EXISTS | `ai_tools_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/tool-bindings` | EXISTS | `ai_tool_bindings_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/tool-bindings` | EXISTS | `ai_tool_bindings_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/tool-bindings/{id}` | EXISTS | `ai_tool_bindings_routes.go` |
| PUT  | `/api/v1/t/{tenant}/ai/tool-bindings/{id}` | EXISTS | `ai_tool_bindings_routes.go` |
| DELETE | `/api/v1/t/{tenant}/ai/tool-bindings/{id}` | EXISTS | `ai_tool_bindings_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/tool-bindings/bulk-attach` | EXISTS | `ai_tool_bindings_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/tool-bindings/preview-condition` | EXISTS | `ai_tool_bindings_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/mcp-servers` | EXISTS | `ai_mcp_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/mcp-servers` | EXISTS | `ai_mcp_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/mcp-servers/{id}` | EXISTS | `ai_mcp_routes.go` |
| PUT  | `/api/v1/t/{tenant}/ai/mcp-servers/{id}` | EXISTS | `ai_mcp_routes.go` |
| PATCH | `/api/v1/t/{tenant}/ai/mcp-servers/{id}` | EXISTS | `ai_mcp_routes.go` |
| DELETE | `/api/v1/t/{tenant}/ai/mcp-servers/{id}` | EXISTS | `ai_mcp_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/mcp-servers/{id}/test` | EXISTS | `ai_mcp_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/mcp-servers/{id}/tools` | EXISTS | `ai_mcp_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/traces` | EXISTS | `ai_traces_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/traces/{id}` | EXISTS | `ai_traces_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/traces/stream` | EXISTS | `ai_traces_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/traces/export/csv` | EXISTS | `ai_traces_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/rate-limits` | EXISTS | `ai_rate_limits_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/rate-limits` | EXISTS | `ai_rate_limits_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/rate-limits/{id}` | EXISTS | `ai_rate_limits_routes.go` |
| PUT  | `/api/v1/t/{tenant}/ai/rate-limits/{id}` | EXISTS | `ai_rate_limits_routes.go` |
| DELETE | `/api/v1/t/{tenant}/ai/rate-limits/{id}` | EXISTS | `ai_rate_limits_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/rate-limits/{id}/metrics` | EXISTS | `ai_rate_limits_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/rate-limits/{id}/simulate` | EXISTS | `ai_rate_limits_routes.go` |
| GET  | `/api/v1/t/{tenant}/ai/virtual-keys` | EXISTS | `ai_extra_routes.go` |
| POST | `/api/v1/t/{tenant}/ai/virtual-keys` | EXISTS | `ai_extra_routes.go` |

## Dashboards + widgets

Source: `dashboards_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/dashboards` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/dashboards` | EXISTS | `dashboards_routes.go` |
| GET  | `/api/v1/t/{tenant}/dashboards/{id}` | EXISTS | `dashboards_routes.go` |
| PUT  | `/api/v1/t/{tenant}/dashboards/{id}` | EXISTS | `dashboards_routes.go` |
| PATCH | `/api/v1/t/{tenant}/dashboards/{id}` | EXISTS | `dashboards_routes.go` |
| DELETE | `/api/v1/t/{tenant}/dashboards/{id}` | EXISTS | `dashboards_routes.go` |
| GET  | `/api/v1/t/{tenant}/dashboards/{id}/widgets` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/dashboards/{id}/widgets` | EXISTS | `dashboards_routes.go` |
| DELETE | `/api/v1/t/{tenant}/dashboards/{id}/widgets/{wid}` | EXISTS | `dashboards_routes.go` |
| PUT  | `/api/v1/t/{tenant}/dashboards/{id}/layout` | EXISTS | `dashboards_routes.go` |
| PUT  | `/api/v1/t/{tenant}/widgets/{id}` | EXISTS | `dashboards_routes.go` |
| PATCH | `/api/v1/t/{tenant}/widgets/{id}` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/widgets/{id}/flip-advanced` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/widgets/{id}/flip-wizard` | EXISTS | `dashboards_routes.go` |
| GET  | `/api/v1/t/{tenant}/dashboards/{id}/versions` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/dashboards/versions/{vid}/restore` | EXISTS | `dashboards_routes.go` |
| GET  | `/api/v1/t/{tenant}/dashboards/{id}/export` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/dashboards/import` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/dashboards/{id}/set-default` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/dashboards/{id}/set-home` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/dashboards/{id}/snapshot` | EXISTS | `dashboards_routes.go` |
| GET  | `/api/v1/t/{tenant}/dashboards/{id}/shares` | EXISTS | `dashboards_routes.go` |
| POST | `/api/v1/t/{tenant}/dashboards/{id}/share` | EXISTS | `dashboards_routes.go` |
| DELETE | `/api/v1/t/{tenant}/dashboards/{id}/shares/{shareId}` | EXISTS | `dashboards_routes.go` |

## Metrics (PromQL proxy)

Source: `promql_routes.go`

| Verb | Path | Status | Notes |
|------|------|--------|-------|
| POST | `/api/v1/t/{tenant}/promql/query` | EXISTS-INCOMPLETE | Returns RFC-7807 501; real Prometheus proxy lands in Plan 8 |

## Audit

Source: `audit_routes.go`, `audit_extra_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/audit` | EXISTS | `audit_routes.go` |
| GET  | `/api/v1/t/{tenant}/audit/{id}` | EXISTS | `audit_routes.go` |
| GET  | `/api/v1/t/{tenant}/audit/actors` | EXISTS | `audit_extra_routes.go` |
| GET  | `/api/v1/t/{tenant}/audit/resource-ids` | EXISTS | `audit_extra_routes.go` |
| GET  | `/api/v1/t/{tenant}/audit/entity/{entityType}/{entityId}` | EXISTS | `audit_extra_routes.go` |
| GET  | `/api/v1/t/{tenant}/audit/stream` | EXISTS | `audit_extra_routes.go` |
| GET  | `/api/v1/t/{tenant}/audit/export/csv` | EXISTS | `audit_extra_routes.go` |
| GET  | `/api/v1/t/{tenant}/audit/export/jsonl` | EXISTS | `audit_extra_routes.go` |
| GET  | `/api/v1/t/{tenant}/audit/retention` | EXISTS | `audit_extra_routes.go` |
| PUT  | `/api/v1/t/{tenant}/audit/retention` | EXISTS | `audit_extra_routes.go` |
| GET  | `/api/v1/audit` | EXISTS | `audit_routes.go` |

## Notifications

Source: `notifications_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/notifications` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/notifications/{id}` | EXISTS | `notifications_routes.go` |
| POST | `/api/v1/t/{tenant}/notifications/{id}/read` | EXISTS | `notifications_routes.go` |
| POST | `/api/v1/t/{tenant}/notifications/{id}/archive` | EXISTS | `notifications_routes.go` |
| POST | `/api/v1/t/{tenant}/notifications/{id}/unarchive` | EXISTS | `notifications_routes.go` |
| POST | `/api/v1/t/{tenant}/notifications/read-all` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/notifications/unread-count` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/notifications/stream` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/notification-channels` | EXISTS | `notifications_routes.go` |
| POST | `/api/v1/t/{tenant}/notification-channels` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/notification-channels/{id}` | EXISTS | `notifications_routes.go` |
| PUT  | `/api/v1/t/{tenant}/notification-channels/{id}` | EXISTS | `notifications_routes.go` |
| DELETE | `/api/v1/t/{tenant}/notification-channels/{id}` | EXISTS | `notifications_routes.go` |
| POST | `/api/v1/t/{tenant}/notification-channels/{id}/test` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/notification-routing` | EXISTS | `notifications_routes.go` |
| POST | `/api/v1/t/{tenant}/notification-routing` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/notification-routing/{id}` | EXISTS | `notifications_routes.go` |
| PUT  | `/api/v1/t/{tenant}/notification-routing/{id}` | EXISTS | `notifications_routes.go` |
| PATCH | `/api/v1/t/{tenant}/settings/webhooks/{id}` | EXISTS | `notifications_routes.go` |
| DELETE | `/api/v1/t/{tenant}/notification-routing/{id}` | EXISTS | `notifications_routes.go` |
| PUT  | `/api/v1/t/{tenant}/notification-routing/order` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/notification-log` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/notification-log/{id}` | EXISTS | `notifications_routes.go` |

## Plugins + plugin-signers

Source: `plugins_routes.go`, `stub_routes.go`

| Verb | Path | Status | Notes |
|------|------|--------|-------|
| GET  | `/api/v1/plugins` | EXISTS-INCOMPLETE | Stub — returns `[]`; real global plugin list in a future plan |
| GET  | `/api/v1/plugins/manifest` | EXISTS-INCOMPLETE | Stub — returns `[]` |
| GET  | `/api/v1/t/{tenant}/plugins` | EXISTS | `plugins_routes.go` |
| POST | `/api/v1/t/{tenant}/plugins/install` | EXISTS | `plugins_routes.go` |
| POST | `/api/v1/t/{tenant}/plugins/install-from-marketplace` | EXISTS | `plugins_routes.go` |
| GET  | `/api/v1/t/{tenant}/plugins/{id}` | EXISTS | `plugins_routes.go` |
| POST | `/api/v1/t/{tenant}/plugins/{id}/enable` | EXISTS | `plugins_routes.go` |
| POST | `/api/v1/t/{tenant}/plugins/{id}/disable` | EXISTS | `plugins_routes.go` |
| DELETE | `/api/v1/t/{tenant}/plugins/{id}` | EXISTS | `plugins_routes.go` |
| GET  | `/api/v1/t/{tenant}/plugins/{id}/build-log` | EXISTS | `plugins_routes.go` |
| GET  | `/api/v1/t/{tenant}/plugin-marketplace` | EXISTS | `plugins_routes.go` |
| GET  | `/api/v1/t/{tenant}/plugin-marketplace/{id}` | EXISTS | `plugins_routes.go` |
| GET  | `/api/v1/t/{tenant}/plugin-signers` | EXISTS | `plugins_routes.go` |
| POST | `/api/v1/t/{tenant}/plugin-signers` | EXISTS | `plugins_routes.go` |
| GET  | `/api/v1/t/{tenant}/plugin-signers/{id}` | EXISTS | `plugins_routes.go` |
| PUT  | `/api/v1/t/{tenant}/plugin-signers/{id}` | EXISTS | `plugins_routes.go` |
| DELETE | `/api/v1/t/{tenant}/plugin-signers/{id}` | EXISTS | `plugins_routes.go` |
| POST | `/api/v1/t/{tenant}/plugin-signers/{id}/revoke` | EXISTS | `plugins_routes.go` |
| POST | `/api/v1/t/{tenant}/plugin-signers/{id}/verify` | EXISTS | `plugins_routes.go` |
| GET  | `/api/v1/t/{tenant}/plugin-signers/{id}/plugins` | EXISTS | `plugins_routes.go` |

## Cluster

Source: `cluster_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/cluster` | EXISTS | `cluster_routes.go` |
| GET  | `/api/v1/cluster/nodes` | EXISTS | `cluster_routes.go` |
| POST | `/api/v1/cluster/sync` | EXISTS | `cluster_routes.go` |
| POST | `/api/v1/cluster/nodes/{id}/remove` | EXISTS | `cluster_routes.go` |
| GET  | `/api/v1/t/{tenant}/cluster/nodes` | EXISTS | `cluster_routes.go` |
| GET  | `/api/v1/t/{tenant}/cluster/nodes/{id}` | EXISTS | `cluster_routes.go` |
| POST | `/api/v1/t/{tenant}/cluster/nodes/{id}/promote` | EXISTS | `cluster_routes.go` |
| POST | `/api/v1/t/{tenant}/cluster/nodes/{id}/demote` | EXISTS | `cluster_routes.go` |
| POST | `/api/v1/t/{tenant}/cluster/nodes/{id}/drain` | EXISTS | `cluster_routes.go` |
| GET  | `/api/v1/t/{tenant}/cluster/enrollment-tokens` | EXISTS | `cluster_routes.go` |
| POST | `/api/v1/t/{tenant}/cluster/enrollment-tokens` | EXISTS | `cluster_routes.go` |
| DELETE | `/api/v1/t/{tenant}/cluster/enrollment-tokens/{id}` | EXISTS | `cluster_routes.go` |

## Settings

Source: `settings_routes.go`, `settings_configs_routes.go`, `settings_runtime.go`, `pki_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/settings/general` | EXISTS | `settings_configs_routes.go` |
| PATCH | `/api/v1/settings/general` | EXISTS | `settings_configs_routes.go` |
| GET  | `/api/v1/settings/auth` | EXISTS | `settings_configs_routes.go` |
| PATCH | `/api/v1/settings/auth` | EXISTS | `settings_configs_routes.go` |
| GET  | `/api/v1/settings/network` | EXISTS | `settings_configs_routes.go` |
| GET  | `/api/v1/settings/caddy` | EXISTS | `settings_configs_routes.go` |
| GET  | `/api/v1/settings/pki` | EXISTS | `settings_configs_routes.go` |
| GET  | `/api/v1/settings/store` | EXISTS | `settings_configs_routes.go` |
| GET  | `/api/v1/settings/traces` | EXISTS | `settings_configs_routes.go` |
| PATCH | `/api/v1/settings/traces` | EXISTS | `settings_configs_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/tenant` | EXISTS | `settings_routes.go` |
| PATCH | `/api/v1/t/{tenant}/settings/tenant` | EXISTS | `settings_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/network` | EXISTS | `settings_routes.go` |
| PUT  | `/api/v1/t/{tenant}/settings/network` | EXISTS | `settings_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/auth-policy` | EXISTS | `settings_routes.go` |
| PUT  | `/api/v1/t/{tenant}/settings/auth-policy` | EXISTS | `settings_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/notifications` | EXISTS | `settings_routes.go` |
| PUT  | `/api/v1/t/{tenant}/settings/notifications` | EXISTS | `settings_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/observability` | EXISTS | `settings_routes.go` |
| PUT  | `/api/v1/t/{tenant}/settings/observability/logs` | EXISTS | `settings_routes.go` |
| PUT  | `/api/v1/t/{tenant}/settings/observability/metrics` | EXISTS | `settings_routes.go` |
| PUT  | `/api/v1/t/{tenant}/settings/observability/traces` | EXISTS | `settings_routes.go` |
| PATCH | `/api/v1/t/{tenant}/settings/me` | EXISTS | `user_routes.go` |
| PATCH | `/api/v1/t/{tenant}/settings/me/name` | EXISTS | `user_routes.go` |
| PATCH | `/api/v1/t/{tenant}/settings/me/avatar` | EXISTS | `user_routes.go` |
| PATCH | `/api/v1/t/{tenant}/settings/me/preferences` | EXISTS | `user_routes.go` |
| POST | `/api/v1/t/{tenant}/settings/me/password` | EXISTS | `user_routes.go` |
| POST | `/api/v1/t/{tenant}/settings/me/backup-codes/reset` | EXISTS | `user_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/webhooks` | EXISTS | `notifications_routes.go` |
| POST | `/api/v1/t/{tenant}/settings/webhooks` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/webhooks/{id}` | EXISTS | `notifications_routes.go` |
| DELETE | `/api/v1/t/{tenant}/settings/webhooks/{id}` | EXISTS | `notifications_routes.go` |
| POST | `/api/v1/t/{tenant}/settings/webhooks/{id}/test` | EXISTS | `notifications_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/danger/export` | EXISTS | `settings_routes.go` |
| DELETE | `/api/v1/t/{tenant}/settings/danger/tenant` | EXISTS | `settings_routes.go` |
| POST | `/api/v1/t/{tenant}/settings/danger/hard-reset` | EXISTS | `settings_routes.go` |

## RBAC

Source: `rbac_routes.go`, `rbac_policies_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/t/{tenant}/rbac-policies` | EXISTS | `rbac_policies_routes.go` |
| POST | `/api/v1/t/{tenant}/rbac-policies` | EXISTS | `rbac_policies_routes.go` |
| GET  | `/api/v1/t/{tenant}/rbac-policies/{id}` | EXISTS | `rbac_policies_routes.go` |
| PUT  | `/api/v1/t/{tenant}/rbac-policies/{id}` | EXISTS | `rbac_policies_routes.go` |
| PATCH | `/api/v1/t/{tenant}/rbac-policies/{id}` | EXISTS | `rbac_policies_routes.go` |
| DELETE | `/api/v1/t/{tenant}/rbac-policies/{id}` | EXISTS | `rbac_policies_routes.go` |
| POST | `/api/v1/t/{tenant}/rbac-policies/{id}/test` | EXISTS | `rbac_policies_routes.go` |

## Access policies

Source: `access_policies_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/auth/access-policies` | EXISTS | `access_policies_routes.go` |
| POST | `/api/v1/auth/access-policies` | EXISTS | `access_policies_routes.go` |
| GET  | `/api/v1/auth/access-policies/{id}` | EXISTS | `access_policies_routes.go` |
| PUT  | `/api/v1/auth/access-policies/{id}` | EXISTS | `access_policies_routes.go` |
| PATCH | `/api/v1/auth/access-policies/{id}` | EXISTS | `access_policies_routes.go` |
| DELETE | `/api/v1/auth/access-policies/{id}` | EXISTS | `access_policies_routes.go` |
| GET  | `/api/v1/t/{tenant}/access-policies` | EXISTS | `access_policies_routes.go` |
| POST | `/api/v1/t/{tenant}/access-policies` | EXISTS | `access_policies_routes.go` |
| GET  | `/api/v1/t/{tenant}/access-policies/{id}` | EXISTS | `access_policies_routes.go` |
| PUT  | `/api/v1/t/{tenant}/access-policies/{id}` | EXISTS | `access_policies_routes.go` |
| PATCH | `/api/v1/t/{tenant}/access-policies/{id}` | EXISTS | `access_policies_routes.go` |
| DELETE | `/api/v1/t/{tenant}/access-policies/{id}` | EXISTS | `access_policies_routes.go` |

## PKI / certificates

Source: `pki_routes.go`, `certificates_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/certificates` | EXISTS | `certificates_routes.go` |
| POST | `/api/v1/certificates/{id}/renew` | EXISTS | `certificates_routes.go` |
| POST | `/api/v1/certificates/{id}/revoke` | EXISTS | `certificates_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/pki/cas` | EXISTS | `pki_routes.go` |
| POST | `/api/v1/t/{tenant}/settings/pki/cas` | EXISTS | `pki_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/pki/cas/{id}` | EXISTS | `pki_routes.go` |
| PUT  | `/api/v1/t/{tenant}/settings/pki/cas/{id}` | EXISTS | `pki_routes.go` |
| DELETE | `/api/v1/t/{tenant}/settings/pki/cas/{id}` | EXISTS | `pki_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/pki/enrollments` | EXISTS | `pki_routes.go` |
| POST | `/api/v1/t/{tenant}/settings/pki/enrollments` | EXISTS | `pki_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/pki/enrollments/{id}` | EXISTS | `pki_routes.go` |
| POST | `/api/v1/t/{tenant}/settings/pki/enrollments/{id}/revoke` | EXISTS | `pki_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/tls/certificates` | EXISTS | `pki_routes.go` |
| POST | `/api/v1/t/{tenant}/settings/tls/certificates` | EXISTS | `pki_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/tls/certificates/{id}` | EXISTS | `pki_routes.go` |
| PATCH | `/api/v1/t/{tenant}/settings/tls/certificates/{id}/auto-renew` | EXISTS | `pki_routes.go` |
| DELETE | `/api/v1/t/{tenant}/settings/tls/certificates/{id}` | EXISTS | `pki_routes.go` |
| GET  | `/api/v1/t/{tenant}/settings/tls/config` | EXISTS | `pki_routes.go` |
| PUT  | `/api/v1/t/{tenant}/settings/tls/config/acme` | EXISTS | `pki_routes.go` |
| PUT  | `/api/v1/t/{tenant}/settings/tls/config/ciphers` | EXISTS | `pki_routes.go` |

## Traffic / observability

Source: `traffic_routes.go`, `observability_routes.go`, `upstream_health_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/traffic/dashboard` | EXISTS | `traffic_routes.go` |
| GET  | `/api/v1/traffic/routes/{id}` | EXISTS | `traffic_routes.go` |
| GET  | `/api/v1/traffic/services/{id}` | EXISTS | `traffic_routes.go` |
| GET  | `/api/v1/events/config` | EXISTS | `traffic_routes.go` |
| GET  | `/api/v1/events/traffic` | EXISTS | `traffic_routes.go` |
| GET  | `/api/v1/observability/jwks` | EXISTS | `observability_routes.go` |
| GET  | `/api/v1/upstreams/health` | EXISTS | `upstream_health_routes.go` |

## Admin (super-admin)

Source: `tenant_routes.go`, `webhooks_cluster_impersonation_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/admin/tenants` | EXISTS | `tenant_routes.go` |
| POST | `/api/v1/admin/tenants` | EXISTS | `tenant_routes.go` |
| GET  | `/api/v1/admin/tenants/{id}` | EXISTS | `tenant_routes.go` |
| PATCH | `/api/v1/admin/tenants/{id}` | EXISTS | `tenant_routes.go` |
| DELETE | `/api/v1/admin/tenants/{id}` | EXISTS | `tenant_routes.go` |
| GET  | `/api/v1/admin/users` | EXISTS | `tenant_routes.go` |
| GET  | `/api/v1/admin/audit` | EXISTS | `audit_routes.go` |
| GET  | `/api/v1/admin/plugin-signers` | EXISTS | `webhooks_cluster_impersonation_routes.go` |
| POST | `/api/v1/admin/plugin-signers` | EXISTS | `webhooks_cluster_impersonation_routes.go` |
| GET  | `/api/v1/admin/plugin-signers/{id}` | EXISTS | `webhooks_cluster_impersonation_routes.go` |
| PUT  | `/api/v1/admin/plugin-signers/{id}` | EXISTS | `webhooks_cluster_impersonation_routes.go` |
| DELETE | `/api/v1/admin/plugin-signers/{id}` | EXISTS | `webhooks_cluster_impersonation_routes.go` |
| GET  | `/api/v1/admin/impersonation` | EXISTS | `webhooks_cluster_impersonation_routes.go` |
| POST | `/api/v1/admin/impersonation` | EXISTS | `webhooks_cluster_impersonation_routes.go` |
| POST | `/api/v1/admin/impersonation/{id}/touch` | EXISTS | `webhooks_cluster_impersonation_routes.go` |
| DELETE | `/api/v1/admin/impersonation/{id}` | EXISTS | `webhooks_cluster_impersonation_routes.go` |

## Keys (signing / PKI keys)

Source: `key_routes.go`

| Verb | Path | Status | Source file |
|------|------|--------|-------------|
| GET  | `/api/v1/keys` | EXISTS | `key_routes.go` |
| POST | `/api/v1/keys` | EXISTS | `key_routes.go` |
| DELETE | `/api/v1/keys/` | EXISTS | `key_routes.go` |
| GET  | `/api/v1/keys/{id}/usage` | EXISTS | `key_routes.go` |

## Infrastructure (health, openapi, events, JWKS, opaque handles)

Source: `openapi_routes.go`, `opaque_routes.go`, `stage2_extras_routes.go`

| Verb | Path | Status | Notes |
|------|------|--------|-------|
| GET  | `/api/v1/openapi.json` | EXISTS | `openapi_routes.go` — added Plan 00c |
| POST | `/api/v1/t/{tenant}/opaque-handles` | EXISTS | `opaque_routes.go` — added Plan 00c |
| GET  | `/api/v1/t/{tenant}/opaque-handles/{handle}` | EXISTS | `opaque_routes.go` — added Plan 00c |
| GET  | `/api/v1/health` | EXISTS | `stage2_extras_routes.go` |
| GET  | `/api/v1/health/caddy` | EXISTS | `stage2_extras_routes.go` |

---

## Endpoints in OpenAPI spec but not in daemon (deferred)

The following paths appear in the published OAS `api.full.json` but have no matching route
registration in the gateway. They are not stubs — they simply do not exist yet. The plan that adds
them should update this manifest.

| Verb | Path | Likely owner plan |
|------|------|-------------------|
| GET  | `/api/v1/ai/virtual-keys` | Plan 04 (AI stage 2) |
| POST | `/api/v1/ai/virtual-keys` | Plan 04 |
| GET/PATCH/DELETE | `/api/v1/ai/virtual-keys/{id}` | Plan 04 |
| POST | `/api/v1/ai/virtual-keys/{id}/revoke` | Plan 04 |
| POST | `/api/v1/ai/virtual-keys/{id}/rotate` | Plan 04 |
| GET/POST/PATCH/DELETE | `/api/v1/applications` | Plan TBD |
| POST | `/api/v1/applications/{id}/transition` | Plan TBD |
| GET/POST/PATCH/DELETE | `/api/v1/plans` | Plan TBD |
| GET/POST/PATCH | `/api/v1/subscriptions` | Plan TBD |
| GET/DELETE + POST | `/api/v1/mcp/routes`, `/api/v1/mcp/teams`, `/api/v1/mcp/permissions` | Plan TBD |
| GET/POST | `/api/v1/traffic/sessions`, `/api/v1/traffic/tokens`, `/api/v1/traffic/traces` | Plan 06 |
| GET/POST/DELETE | `/api/v1/build`, `/api/v1/config` | Plan TBD |

> This deferral list will be expanded to per-row classification in Plan 0d.
