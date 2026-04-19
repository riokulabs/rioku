/**
 * MCP Servers API — backed by the Zustand mock store.
 *
 * Mirrors features/services/api.ts:
 *   - selectors pull raw Records, derive outside the selector body
 *   - mutations call simulateLatency + appendAudit + emitHostEvent
 *
 * `testMcpServer` is a deterministic pseudo-health-check: ~15% of calls fail,
 * driven by a hash of (server id, coarse time bucket). On success the server's
 * `health` is set to `'healthy'` and `last_seen_at` updated; on failure
 * `health` flips to `'unreachable'`.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AiTool, AuditEntry, McpServer } from '@/api/resources/types';
import type {
  CreateMcpServerInput,
  McpServerFilter,
  TestMcpServerResult,
  UpdateMcpServerInput,
} from './types';

const nextMcpServerId = makeIdFactory('mcpsrv-new');
const nextAuditId = makeIdFactory('audit-mcpsrv');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function getCurrentActorId(): string {
  return useMockStore.getState().currentUserId ?? 'unknown';
}

function makeAuditEntry(
  actorId: string,
  tenantId: string | null,
  action: string,
  resourceId?: string,
  tier: AuditEntry['tier'] = 'write',
): AuditEntry {
  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    resource_type: 'mcp-server',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier,
  };
}

function credentialPrefix(raw: string): string {
  return raw.slice(0, Math.min(12, raw.length));
}

/** djb2 string hash — deterministic, never negative. */
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useMcpServerList(
  tenantId: string,
  filter: McpServerFilter,
): McpServer[] {
  const servers = useMockStore((s) => s.mcpServers);
  const search = filter.search.toLowerCase().trim();
  const results: McpServer[] = [];
  for (const srv of Object.values(servers)) {
    if (srv.tenant_id !== tenantId) continue;
    if (filter.healths.length > 0 && !filter.healths.includes(srv.health)) continue;
    if (filter.auth_kinds.length > 0 && !filter.auth_kinds.includes(srv.auth_kind))
      continue;
    if (filter.enabled !== undefined && srv.enabled !== filter.enabled) continue;
    if (search) {
      const nameMatch = srv.name.toLowerCase().includes(search);
      const descMatch = srv.description?.toLowerCase().includes(search) ?? false;
      const urlMatch = srv.url.toLowerCase().includes(search);
      if (!nameMatch && !descMatch && !urlMatch) continue;
    }
    results.push(srv);
  }
  return results;
}

export function useMcpServerDetail(id: string): McpServer | undefined {
  return useMockStore((s) => s.mcpServers[id]);
}

/** Tools exposed by the given MCP server. */
export function useMcpServerTools(id: string): AiTool[] {
  const tools = useMockStore((s) => s.aiTools);
  const out: AiTool[] = [];
  for (const t of Object.values(tools)) {
    if (t.mcp_server_id === id) out.push(t);
  }
  return out;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createMcpServer(
  tenantId: string,
  input: CreateMcpServerInput,
): Promise<McpServer> {
  await simulateLatency('mutation');
  const id = nextMcpServerId();
  const server: McpServer = {
    id,
    tenant_id: tenantId,
    name: input.name,
    url: input.url,
    auth_kind: input.auth_kind,
    enabled: input.enabled ?? true,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.auth_credential !== undefined
      ? {
          auth_credential_ref: {
            prefix: credentialPrefix(input.auth_credential),
            created_at: now(),
          },
        }
      : {}),
    authorized_agent_ids: [...(input.authorized_agent_ids ?? [])],
    health: input.enabled === false ? 'disabled' : 'healthy',
    exposed_tool_count: 0,
    created_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('mcpServers', server);
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), tenantId, 'mcp-server.create', id),
  );
  emitHostEvent('mcp-server.created', {
    mcp_server_id: id,
    tenant_id: tenantId,
    auth_kind: input.auth_kind,
  });
  return server;
}

export async function updateMcpServer(
  id: string,
  input: UpdateMcpServerInput,
): Promise<McpServer> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.mcpServers[id];
  if (!current) throw new Error(`MCP server ${id} not found`);

  const patch: Partial<McpServer> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.url !== undefined) patch.url = input.url;
  if (input.auth_kind !== undefined) patch.auth_kind = input.auth_kind;
  if (input.description !== undefined) patch.description = input.description;
  if (input.auth_credential !== undefined) {
    patch.auth_credential_ref = {
      prefix: credentialPrefix(input.auth_credential),
      created_at: now(),
    };
  }
  if (input.authorized_agent_ids !== undefined)
    patch.authorized_agent_ids = [...input.authorized_agent_ids];
  if (input.enabled !== undefined) {
    patch.enabled = input.enabled;
    // Disabling a server parks its health; enabling requires a test to prove health.
    if (!input.enabled) patch.health = 'disabled';
    else if (current.health === 'disabled') patch.health = 'degraded';
  }

  const before = { ...current };
  state.updateEntity('mcpServers', id, patch);
  const updated = useMockStore.getState().mcpServers[id];
  if (!updated) throw new Error(`MCP server ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(
      getCurrentActorId(),
      current.tenant_id,
      'mcp-server.update',
      id,
    ),
    diff: { before, after: updated },
  });
  emitHostEvent('mcp-server.updated', {
    mcp_server_id: id,
    tenant_id: current.tenant_id,
  });
  return updated;
}

/**
 * Delete an MCP server. Guards against orphaning tools: if any tool in the
 * store references this server via `mcp_server_id`, the delete is refused and
 * the error names the referencing tools so the caller can surface a clear
 * prompt ("unbind these tools first").
 */
export async function deleteMcpServer(id: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const server = state.mcpServers[id];
  if (!server) throw new Error(`MCP server ${id} not found`);

  const referencingTools = Object.values(state.aiTools).filter(
    (t) => t.mcp_server_id === id,
  );
  if (referencingTools.length > 0) {
    const names = referencingTools.map((t) => t.name).slice(0, 5).join(', ');
    const more = referencingTools.length > 5 ? ` and ${String(referencingTools.length - 5)} more` : '';
    throw new Error(
      `Cannot delete MCP server ${id}: ${String(referencingTools.length)} tool(s) reference it (${names}${more}).`,
    );
  }

  state.deleteEntity('mcpServers', id);
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      server.tenant_id,
      'mcp-server.delete',
      id,
      'destructive',
    ),
  );
  emitHostEvent('mcp-server.deleted', {
    mcp_server_id: id,
    tenant_id: server.tenant_id,
  });
}

// ─── Test connection ─────────────────────────────────────────────────────────

/**
 * Mock connectivity probe. Latency is derived from a hash of the server id
 * (stable across retries within a time bucket). ~15% of calls are forced
 * failures via `(hash + Date.now() % 20) < 3` — the `Date.now()` component
 * ensures retries can eventually succeed without requiring time-travel in tests.
 *
 * On success: `health = 'healthy'`, `last_seen_at = now`, `exposed_tool_count`
 * is recomputed from the tools store.
 * On failure: `health = 'unreachable'`.
 */
export async function testMcpServer(id: string): Promise<TestMcpServerResult> {
  await simulateLatency('query');
  const state = useMockStore.getState();
  const server = state.mcpServers[id];
  if (!server) throw new Error(`MCP server ${id} not found`);

  const seed = hashCode(id);
  const latency = 40 + (seed % 220); // 40–260 ms
  const roll = (seed + (Date.now() % 20)) % 20;
  const ok = roll >= 3; // ~15% failure rate

  const toolCount = Object.values(state.aiTools).filter(
    (t) => t.mcp_server_id === id,
  ).length;
  const testedAt = now();

  if (ok) {
    state.updateEntity('mcpServers', id, {
      health: 'healthy',
      last_seen_at: testedAt,
      exposed_tool_count: toolCount,
    });
  } else {
    state.updateEntity('mcpServers', id, {
      health: 'unreachable',
    });
  }

  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      server.tenant_id,
      ok ? 'mcp-server.test.success' : 'mcp-server.test.failure',
      id,
      'read',
    ),
  );
  emitHostEvent('mcp-server.tested', {
    mcp_server_id: id,
    tenant_id: server.tenant_id,
    ok,
    latency_ms: latency,
  });

  return {
    ok,
    latency_ms: latency,
    tool_count: toolCount,
    tested_at: testedAt,
    ...(ok ? {} : { error_message: 'mock: upstream MCP returned 503' }),
  };
}
