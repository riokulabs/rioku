/**
 * AI Tool Routing (bindings) API — backed by the Zustand mock store.
 *
 * Bindings attach a single tool to a single agent with an optional CEL
 * condition. `previewCondition` parses the CEL via the lazy loader in
 * `@/lib/cel-parser` — it does NOT evaluate, consistent with the safety
 * posture of the access-policies feature.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import { parseCel } from '@/lib/cel-parser';
import type { AiToolBinding, AuditEntry } from '@/api/resources';
import type {
  BindingFilter,
  CreateBindingInput,
  PreviewConditionResult,
  UpdateBindingInput,
} from './types';

const nextBindingId = makeIdFactory('aibinding-new');
const nextAuditId = makeIdFactory('audit-aibinding');

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
    resource_type: 'ai-tool-binding',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier,
  };
}

function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useBindingList(tenantId: string, filter: BindingFilter): AiToolBinding[] {
  const bindings = useMockStore((s) => s.aiToolBindings);
  const results: AiToolBinding[] = [];
  for (const b of Object.values(bindings)) {
    if (b.tenant_id !== tenantId) continue;
    if (filter.agent_ids.length > 0 && !filter.agent_ids.includes(b.agent_id)) continue;
    if (filter.tool_ids.length > 0 && !filter.tool_ids.includes(b.tool_id)) continue;
    if (filter.enabled !== undefined && b.enabled !== filter.enabled) continue;
    if (filter.has_condition !== undefined) {
      const has = b.condition.trim().length > 0;
      if (has !== filter.has_condition) continue;
    }
    results.push(b);
  }
  return results;
}

export function useBindingDetail(id: string): AiToolBinding | undefined {
  return useMockStore((s) => s.aiToolBindings[id]);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createBinding(
  tenantId: string,
  input: CreateBindingInput,
): Promise<AiToolBinding> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();

  // Enforce uniqueness: (agent_id, tool_id) may have at most one binding.
  const existing = Object.values(state.aiToolBindings).find(
    (b) => b.tenant_id === tenantId && b.agent_id === input.agent_id && b.tool_id === input.tool_id,
  );
  if (existing) {
    throw new Error(`Binding already exists for agent ${input.agent_id} + tool ${input.tool_id}`);
  }

  const id = nextBindingId();
  const binding: AiToolBinding = {
    id,
    tenant_id: tenantId,
    agent_id: input.agent_id,
    tool_id: input.tool_id,
    condition: input.condition,
    enabled: input.enabled ?? true,
    created_at: now(),
  };
  state.addEntity('aiToolBindings', binding);
  state.appendAudit(makeAuditEntry(getCurrentActorId(), tenantId, 'ai-tool-binding.create', id));
  emitHostEvent('ai-tool-binding.created', {
    binding_id: id,
    tenant_id: tenantId,
    agent_id: input.agent_id,
    tool_id: input.tool_id,
  });
  return binding;
}

export async function updateBinding(id: string, input: UpdateBindingInput): Promise<AiToolBinding> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.aiToolBindings[id];
  if (!current) throw new Error(`Binding ${id} not found`);

  const patch: Partial<AiToolBinding> = {};
  if (input.agent_id !== undefined) patch.agent_id = input.agent_id;
  if (input.tool_id !== undefined) patch.tool_id = input.tool_id;
  if (input.condition !== undefined) patch.condition = input.condition;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const before = { ...current };
  state.updateEntity('aiToolBindings', id, patch);
  const updated = useMockStore.getState().aiToolBindings[id];
  if (!updated) throw new Error(`Binding ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), current.tenant_id, 'ai-tool-binding.update', id),
    diff: { before, after: updated },
  });
  emitHostEvent('ai-tool-binding.updated', {
    binding_id: id,
    tenant_id: current.tenant_id,
  });
  return updated;
}

export async function deleteBinding(id: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const binding = state.aiToolBindings[id];
  if (!binding) throw new Error(`Binding ${id} not found`);

  state.deleteEntity('aiToolBindings', id);
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      binding.tenant_id,
      'ai-tool-binding.delete',
      id,
      'destructive',
    ),
  );
  emitHostEvent('ai-tool-binding.deleted', {
    binding_id: id,
    tenant_id: binding.tenant_id,
  });
}

/**
 * Create bindings for each toolId, idempotently. A binding that already
 * exists for (agentId, toolId) is skipped (no duplicate error surfaces).
 *
 * Multi-entity insert runs under a single `setState` so observers see the
 * change atomically.
 */
export async function bulkAttachToolsToAgent(
  tenantId: string,
  agentId: string,
  toolIds: string[],
): Promise<AiToolBinding[]> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const existingByKey = new Map<string, AiToolBinding>();
  for (const b of Object.values(state.aiToolBindings)) {
    if (b.agent_id === agentId) {
      existingByKey.set(b.tool_id, b);
    }
  }

  const newBindings: AiToolBinding[] = [];
  for (const toolId of toolIds) {
    if (existingByKey.has(toolId)) continue;
    newBindings.push({
      id: nextBindingId(),
      tenant_id: tenantId,
      agent_id: agentId,
      tool_id: toolId,
      condition: '',
      enabled: true,
      created_at: now(),
    });
  }

  if (newBindings.length > 0) {
    useMockStore.setState((s) => {
      const next = { ...s.aiToolBindings };
      for (const b of newBindings) next[b.id] = b;
      return { aiToolBindings: next };
    });
    state.appendAudit(
      makeAuditEntry(getCurrentActorId(), tenantId, 'ai-tool-binding.bulk-attach', agentId),
    );
    emitHostEvent('ai-tool-binding.bulk-attached', {
      tenant_id: tenantId,
      agent_id: agentId,
      attached_count: newBindings.length,
    });
  }

  // Return the full list of bindings the agent now has for the requested tools.
  const full: AiToolBinding[] = [];
  for (const toolId of toolIds) {
    const existing = existingByKey.get(toolId);
    if (existing) full.push(existing);
    else {
      const created = newBindings.find((b) => b.tool_id === toolId);
      if (created) full.push(created);
    }
  }
  return full;
}

// ─── CEL preview ─────────────────────────────────────────────────────────────

/**
 * Parse (only) the binding's CEL condition. If the parse succeeds we produce
 * a deterministic boolean `sample_result` based on a cheap hash — the real
 * evaluation happens on the daemon side, this surface just tells the user
 * whether the condition is syntactically valid and what it would evaluate to
 * for the supplied sample shape in a reproducible way.
 */
export async function previewCondition(
  condition: string,
  _sampleContext: Record<string, unknown>,
): Promise<PreviewConditionResult> {
  if (!condition.trim()) {
    return { parses: true, sample_result: true };
  }
  const result = await parseCel(condition);
  if (!result.ok) {
    return { parses: false, error: result.error };
  }
  // Deterministic sample_result — stable for a given condition string.
  const sample = hashCode(condition) % 2 === 0;
  return { parses: true, sample_result: sample };
}
