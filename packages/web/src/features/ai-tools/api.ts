/**
 * AI Tools API — backed by the Zustand mock store.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AiAgent, AiTool, AuditEntry } from '@/api/resources/types';
import { ToolInUseError } from './types';
import type { CreateToolInput, TestToolResult, ToolFilter, UpdateToolInput } from './types';

const nextToolId = makeIdFactory('aitool-new');
const nextAuditId = makeIdFactory('audit-aitool');

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
    resource_type: 'ai-tool',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier,
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useToolList(tenantId: string, filter: ToolFilter): AiTool[] {
  const tools = useMockStore((s) => s.aiTools);
  const search = filter.search.toLowerCase().trim();
  const results: AiTool[] = [];
  for (const tool of Object.values(tools)) {
    if (tool.tenant_id !== tenantId) continue;
    if (filter.kinds.length > 0 && !filter.kinds.includes(tool.kind)) continue;
    if (filter.enabled !== undefined && tool.enabled !== filter.enabled) continue;
    if (filter.dangerous !== undefined && tool.dangerous !== filter.dangerous) continue;
    if (filter.mcp_server_id !== undefined) {
      if (tool.mcp_server_id !== filter.mcp_server_id) continue;
    }
    if (search) {
      const nameMatch = tool.name.toLowerCase().includes(search);
      const descMatch = tool.description.toLowerCase().includes(search);
      if (!nameMatch && !descMatch) continue;
    }
    results.push(tool);
  }
  return results;
}

export function useToolDetail(id: string): AiTool | undefined {
  return useMockStore((s) => s.aiTools[id]);
}

/**
 * Return all agents that could invoke this tool — either via their
 * direct `tool_ids` list or via a binding.
 */
export function useToolAgents(id: string): AiAgent[] {
  const agents = useMockStore((s) => s.aiAgents);
  const bindings = useMockStore((s) => s.aiToolBindings);
  const agentIdsFromBindings = new Set<string>();
  for (const b of Object.values(bindings)) {
    if (b.tool_id === id) agentIdsFromBindings.add(b.agent_id);
  }
  const result: AiAgent[] = [];
  const seen = new Set<string>();
  for (const a of Object.values(agents)) {
    if (a.tool_ids.includes(id) || agentIdsFromBindings.has(a.id)) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        result.push(a);
      }
    }
  }
  return result;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createTool(tenantId: string, input: CreateToolInput): Promise<AiTool> {
  await simulateLatency('mutation');

  const id = nextToolId();
  const tool: AiTool = {
    id,
    tenant_id: tenantId,
    name: input.name,
    description: input.description,
    schema: input.schema,
    kind: input.kind,
    ...(input.mcp_server_id !== undefined ? { mcp_server_id: input.mcp_server_id } : {}),
    ...(input.http_endpoint !== undefined ? { http_endpoint: input.http_endpoint } : {}),
    dangerous: input.dangerous ?? false,
    enabled: input.enabled ?? true,
    created_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('aiTools', tool);
  state.appendAudit(makeAuditEntry(getCurrentActorId(), tenantId, 'ai-tool.create', id));
  emitHostEvent('ai-tool.created', { tool_id: id, tenant_id: tenantId });
  return tool;
}

export async function updateTool(id: string, input: UpdateToolInput): Promise<AiTool> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.aiTools[id];
  if (!current) throw new Error(`Tool ${id} not found`);

  const patch: Partial<AiTool> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.schema !== undefined) patch.schema = input.schema;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.mcp_server_id !== undefined) patch.mcp_server_id = input.mcp_server_id;
  if (input.http_endpoint !== undefined) patch.http_endpoint = input.http_endpoint;
  if (input.dangerous !== undefined) patch.dangerous = input.dangerous;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const before = { ...current };
  state.updateEntity('aiTools', id, patch);
  const updated = useMockStore.getState().aiTools[id];
  if (!updated) throw new Error(`Tool ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), current.tenant_id, 'ai-tool.update', id),
    diff: { before, after: updated },
  });
  emitHostEvent('ai-tool.updated', {
    tool_id: id,
    tenant_id: current.tenant_id,
  });
  return updated;
}

export async function deleteTool(id: string): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const tool = state.aiTools[id];
  if (!tool) throw new Error(`Tool ${id} not found`);

  const referencingAgentIds = Object.values(state.aiAgents)
    .filter((a) => a.tool_ids.includes(id))
    .map((a) => a.id);
  const referencingBindingIds = Object.values(state.aiToolBindings)
    .filter((b) => b.tool_id === id)
    .map((b) => b.id);
  if (referencingAgentIds.length > 0 || referencingBindingIds.length > 0) {
    throw new ToolInUseError(referencingAgentIds, referencingBindingIds);
  }

  state.deleteEntity('aiTools', id);
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), tool.tenant_id, 'ai-tool.delete', id, 'destructive'),
  );
  emitHostEvent('ai-tool.deleted', {
    tool_id: id,
    tenant_id: tool.tenant_id,
  });
}

// ─── Testing (mock) ──────────────────────────────────────────────────────────

/**
 * Validate `sampleInput` against `tool.schema` (top-level `required` keys +
 * any declared `type` for primitives). Deliberately shallow: we're mocking a
 * daemon-side validator, not implementing draft-07 fully.
 */
export async function testTool(
  id: string,
  sampleInput: Record<string, unknown>,
): Promise<TestToolResult> {
  await simulateLatency('query');

  const tool = useMockStore.getState().aiTools[id];
  if (!tool) throw new Error(`Tool ${id} not found`);

  const schema = tool.schema;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties =
    typeof schema.properties === 'object' && schema.properties !== null
      ? (schema.properties as Record<string, { type?: string }>)
      : {};

  for (const key of required) {
    if (typeof key !== 'string') continue;
    if (!(key in sampleInput)) {
      return {
        ok: false,
        error: `Missing required field: ${key}`,
      };
    }
  }
  for (const [key, decl] of Object.entries(properties)) {
    if (!(key in sampleInput)) continue;
    if (decl.type === undefined) continue;
    const v = sampleInput[key];
    const actualType = Array.isArray(v) ? 'array' : typeof v;
    const expected = decl.type;
    if (expected === 'integer') {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        return {
          ok: false,
          error: `Field ${key} expected integer, got ${actualType}`,
        };
      }
      continue;
    }
    if (actualType !== expected) {
      return {
        ok: false,
        error: `Field ${key} expected ${expected}, got ${actualType}`,
      };
    }
  }

  useMockStore
    .getState()
    .appendAudit(makeAuditEntry(getCurrentActorId(), tool.tenant_id, 'ai-tool.test', id, 'read'));
  return {
    ok: true,
    result: { echo: sampleInput, tool_name: tool.name },
  };
}
