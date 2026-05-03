# D9: MCP Authentication Model — Key + Team Only in v1; Agent Concept in v3

**Date**: 2026-04-30
**Issue**: #181
**Status**: Accepted

## Context

The MCP (Model Context Protocol) gateway lets agents discover and
invoke tools from one or more upstream MCP servers. Authentication
needs to answer: *which agent is calling, which tools is it
allowed to call, who pays for the cost?*

The full MCP authentication landscape has three plausible models:

1. **Key + team** (v1): the caller presents an API key. The key
   resolves to a team. The team has a fixed allow-list of MCP
   servers + tools. Spend rolls up to the team. Simple, one
   level of indirection.
2. **Agent identity** (v3): the caller presents an *agent
   identity* — a key + capabilities + per-tool budgets +
   optional per-tool tokens. Agents are first-class entities
   that the admin can audit, pause, scope, and cap.
3. **OIDC delegation** (deferred indefinitely): the caller is a
   human-on-behalf-of-agent OAuth-shaped flow with downstream
   tokens. Real but rare; most v1 deployments don't need it.

## Decision

**Key + team in v1. Agent concept lands in v3.** OIDC delegation
defers indefinitely until customer signal.

The v1 model is: an existing Rioku API key (Sprint 3 #179)
resolves to a Team — a thin wrapper that enumerates which MCP
servers + tools the team is allowed to call. Spend attribution,
rate-limit, and audit all roll up to the team's id.

## Why v1 stops at "team"

- **Reuses existing infrastructure.** Rioku already has API
  keys (#179). Wrapping them with a team allow-list is a single
  table — no new auth flow, no new key issuance, no new token
  type.
- **Most operators don't need agent-level granularity yet.**
  Per the competitive analysis (`tmp/competitors/SYNTHESIS.md`),
  half the MCP gateways ship without agent-level identity in
  their v1 — the use case is "this team gets these tools," not
  "agent X can call tool Y but not tool Z, and tool Y costs at
  most $5 per agent-day."
- **Agent identity isn't free to design.** Capabilities,
  per-tool budgets, agent-vs-team rollups, agent pause/resume,
  audit fields. Each is its own design surface. Punting them
  to v3 lets v1 ship.

## What v1 ships

- **Team table** (`mcp_teams`): `id, tenant_id, name,
  description, status (active|paused|closed)`.
- **Team-tool allow-list** (`mcp_team_permissions`): `team_id,
  mcp_server_id, tool_name`. Wildcard `tool_name = '*'` allows
  every tool exposed by the named server.
- **API-key-to-team binding**: `api_keys.mcp_team_id` (nullable
  FK; non-MCP keys leave it NULL).
- **MCP gateway resolution**: when an API key arrives at the
  MCP gateway, the resolution chain is Key → MCPTeam →
  allow-list. Tools not on the list are rejected with 403.
  Allowed tools fan out to the configured MCP server.

## What v3 will ship

- **Agent table** (`mcp_agents`): `id, tenant_id, team_id,
  name, capabilities (JSON), per_tool_budgets (JSON),
  status`.
- **Per-(agent, tool) accounting**: the spend log gains an
  `agent_id` foreign key.
- **Agent pause/resume + audit fields** for the admin's
  agent-management UI.

## Consequences

- **Migration 44 (Sprint 5 Phase 4):** `mcp_teams` +
  `mcp_team_permissions` tables. `api_keys.mcp_team_id` column.
- **MCP gateway** (above the daemon's AI gateway, per D7) pulls
  the resolution chain at request time. The chain helper from
  Phase 1c (`store.ResolveAPIKeyChain`) extends with an MCP
  branch that checks team + allow-list when the key is bound
  to an MCP team.
- **REST surface:** `/api/v1/t/{tenant}/mcp-teams` for CRUD +
  permission management. Standard pattern from Sprint 4 Phase
  1b.
- **The AI proxy is unaffected.** AI providers (OpenAI / Anthropic
  / …) auth through virtual keys (#167), not MCP teams. Two
  parallel auth-resolution chains in the daemon, one per
  protocol family.
- **Audit:** team creation + permission updates + key bindings
  emit audit entries via the typed-payload registry (#182).
  Schema: `mcp.team_event.v1` with payload fields `team_id,
  action (created|paused|closed|...), permissions_changed`.
