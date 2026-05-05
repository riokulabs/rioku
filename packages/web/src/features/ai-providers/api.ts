/**
 * AI Providers API — backed by the Zustand mock store.
 *
 * Mirrors features/services/api.ts:
 *   - selectors pull raw Records, derive outside the selector body
 *   - mutations call simulateLatency + appendAudit + emitHostEvent
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AiAgent, AiProvider, AiProviderModel, AuditEntry } from '@/api/resources';
import { ProviderInUseError, ProviderModelInUseError } from './types';
import type {
  AddModelInput,
  CreateProviderInput,
  ProviderFilter,
  TestProviderResult,
  UpdateModelInput,
  UpdateProviderInput,
} from './types';

const nextProviderId = makeIdFactory('aiprov-new');
const nextAuditId = makeIdFactory('audit-aiprov');

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
    resource_type: 'ai-provider',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier,
  };
}

/** Extract a display prefix from a raw credential. Keeps first 12 chars. */
function credentialPrefix(raw: string): string {
  return raw.slice(0, Math.min(12, raw.length));
}

/**
 * Deterministic hash — djb2 over the source string.
 * Used for reproducible failure simulation in testProvider.
 */
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Returns providers for a tenant, filtered by `filter`.
 * Selector returns raw record; filter/derivation happens in the hook body so
 * the returned array reference updates only when input changes.
 */
export function useProviderList(tenantId: string, filter: ProviderFilter): AiProvider[] {
  const providers = useMockStore((s) => s.aiProviders);

  const search = filter.search.toLowerCase().trim();
  const results: AiProvider[] = [];
  for (const provider of Object.values(providers)) {
    if (provider.tenant_id !== tenantId) continue;
    if (filter.kinds.length > 0 && !filter.kinds.includes(provider.kind)) continue;
    if (filter.enabled !== undefined && provider.enabled !== filter.enabled) continue;
    if (search) {
      const nameMatch = provider.name.toLowerCase().includes(search);
      const urlMatch = provider.base_url.toLowerCase().includes(search);
      const descMatch = provider.description?.toLowerCase().includes(search) ?? false;
      if (!nameMatch && !urlMatch && !descMatch) continue;
    }
    results.push(provider);
  }
  return results;
}

/** Return a single provider by ID. */
export function useProviderDetail(providerId: string): AiProvider | undefined {
  return useMockStore((s) => s.aiProviders[providerId]);
}

/** Return all agents using this provider. */
export function useProviderAgents(providerId: string): AiAgent[] {
  const agents = useMockStore((s) => s.aiAgents);
  return Object.values(agents).filter((a) => a.provider_id === providerId);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createProvider(
  tenantId: string,
  input: CreateProviderInput,
): Promise<AiProvider> {
  await simulateLatency('mutation');

  const id = nextProviderId();
  const provider: AiProvider = {
    id,
    tenant_id: tenantId,
    name: input.name,
    kind: input.kind,
    base_url: input.base_url,
    enabled: input.enabled ?? true,
    ...(input.description !== undefined ? { description: input.description } : {}),
    credential_ref: {
      prefix: credentialPrefix(input.credential),
      created_at: now(),
    },
    models: [],
    created_at: now(),
    updated_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('aiProviders', provider);
  state.appendAudit(makeAuditEntry(getCurrentActorId(), tenantId, 'ai-provider.create', id));
  emitHostEvent('ai-provider.created', { provider_id: id, tenant_id: tenantId });
  return provider;
}

export async function updateProvider(id: string, input: UpdateProviderInput): Promise<AiProvider> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.aiProviders[id];
  if (!current) {
    throw new Error(`Provider ${id} not found`);
  }

  const patch: Partial<AiProvider> = { updated_at: now() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.base_url !== undefined) patch.base_url = input.base_url;
  if (input.description !== undefined) patch.description = input.description;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.credential !== undefined) {
    patch.credential_ref = {
      prefix: credentialPrefix(input.credential),
      created_at: now(),
    };
  }

  const before = { ...current };
  state.updateEntity('aiProviders', id, patch);
  const updated = useMockStore.getState().aiProviders[id];
  if (!updated) throw new Error(`Provider ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), current.tenant_id, 'ai-provider.update', id),
    diff: { before, after: updated },
  });
  emitHostEvent('ai-provider.updated', {
    provider_id: id,
    tenant_id: current.tenant_id,
  });
  return updated;
}

export async function deleteProvider(id: string): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const provider = state.aiProviders[id];
  if (!provider) {
    throw new Error(`Provider ${id} not found`);
  }

  const referencingAgentIds = Object.values(state.aiAgents)
    .filter((a) => a.provider_id === id)
    .map((a) => a.id);
  if (referencingAgentIds.length > 0) {
    throw new ProviderInUseError(referencingAgentIds);
  }

  state.deleteEntity('aiProviders', id);
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      provider.tenant_id,
      'ai-provider.delete',
      id,
      'destructive',
    ),
  );
  emitHostEvent('ai-provider.deleted', {
    provider_id: id,
    tenant_id: provider.tenant_id,
  });
}

// ─── Model management ────────────────────────────────────────────────────────

export async function addModel(providerId: string, model: AddModelInput): Promise<AiProvider> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.aiProviders[providerId];
  if (!current) throw new Error(`Provider ${providerId} not found`);

  if (current.models.some((m) => m.alias === model.alias)) {
    throw new Error(`Model alias ${model.alias} already exists on this provider`);
  }

  const newModel: AiProviderModel = {
    upstream_id: model.upstream_id,
    alias: model.alias,
    rate_limit_rpm: model.rate_limit_rpm,
    daily_quota_tokens: model.daily_quota_tokens,
    enabled: model.enabled ?? true,
  };
  const models = [...current.models, newModel];
  state.updateEntity('aiProviders', providerId, {
    models,
    updated_at: now(),
  });
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), current.tenant_id, 'ai-provider.model.add', providerId),
  );
  emitHostEvent('ai-provider.model-added', {
    provider_id: providerId,
    alias: model.alias,
  });
  const updated = useMockStore.getState().aiProviders[providerId];
  if (!updated) throw new Error('Provider vanished');
  return updated;
}

export async function updateModel(
  providerId: string,
  upstreamId: string,
  patch: UpdateModelInput,
): Promise<AiProvider> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.aiProviders[providerId];
  if (!current) throw new Error(`Provider ${providerId} not found`);

  const idx = current.models.findIndex((m) => m.upstream_id === upstreamId);
  if (idx < 0) throw new Error(`Model ${upstreamId} not found on provider`);

  const existing = current.models[idx];
  if (!existing) throw new Error(`Model ${upstreamId} not found on provider`);
  const updatedModel: AiProviderModel = {
    ...existing,
    ...(patch.alias !== undefined ? { alias: patch.alias } : {}),
    ...(patch.rate_limit_rpm !== undefined ? { rate_limit_rpm: patch.rate_limit_rpm } : {}),
    ...(patch.daily_quota_tokens !== undefined
      ? { daily_quota_tokens: patch.daily_quota_tokens }
      : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
  };
  const models = [...current.models];
  models[idx] = updatedModel;

  state.updateEntity('aiProviders', providerId, { models, updated_at: now() });
  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), current.tenant_id, 'ai-provider.model.update', providerId),
  );
  const updated = useMockStore.getState().aiProviders[providerId];
  if (!updated) throw new Error('Provider vanished');
  return updated;
}

export async function removeModel(providerId: string, upstreamId: string): Promise<AiProvider> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const current = state.aiProviders[providerId];
  if (!current) throw new Error(`Provider ${providerId} not found`);

  const model = current.models.find((m) => m.upstream_id === upstreamId);
  if (!model) throw new Error(`Model ${upstreamId} not found on provider`);

  // Guard: no agent may reference this alias.
  const usingAgents = Object.values(state.aiAgents)
    .filter((a) => a.provider_id === providerId && a.model === model.alias)
    .map((a) => a.id);
  if (usingAgents.length > 0) {
    throw new ProviderModelInUseError(usingAgents);
  }

  const models = current.models.filter((m) => m.upstream_id !== upstreamId);
  state.updateEntity('aiProviders', providerId, { models, updated_at: now() });
  state.appendAudit(
    makeAuditEntry(
      getCurrentActorId(),
      current.tenant_id,
      'ai-provider.model.remove',
      providerId,
      'destructive',
    ),
  );
  const updated = useMockStore.getState().aiProviders[providerId];
  if (!updated) throw new Error('Provider vanished');
  return updated;
}

// ─── Test connection (deterministic mock) ────────────────────────────────────

export async function testProvider(providerId: string): Promise<TestProviderResult> {
  const state = useMockStore.getState();
  const provider = state.aiProviders[providerId];
  if (!provider) throw new Error(`Provider ${providerId} not found`);

  // Simulate 300-800ms latency for the test call.
  const simulatedLatency = 300 + Math.floor(Math.random() * 500);
  await new Promise<void>((resolve) => setTimeout(resolve, simulatedLatency));

  // Deterministic 10% failure rate: hash(id) + Date.now()%10 — reproducible
  // within a single render cycle (tests pin Date.now) but varies across calls.
  const failureSlot = (hashCode(provider.id) + Math.floor(Date.now() / 1000)) % 10;
  const ok = failureSlot !== 0;

  const result: TestProviderResult = {
    ok,
    latency_ms: simulatedLatency,
    tested_at: now(),
    ...(ok ? {} : { error_message: 'mock: upstream returned 503' }),
  };

  state.appendAudit(
    makeAuditEntry(getCurrentActorId(), provider.tenant_id, 'ai-provider.test', providerId, 'read'),
  );
  emitHostEvent('ai-provider.tested', {
    provider_id: providerId,
    ok,
    latency_ms: simulatedLatency,
  });
  return result;
}
