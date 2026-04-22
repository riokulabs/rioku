/**
 * Middlewares API — backed by the Zustand mock store.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AuditEntry, Middleware } from '@/api/resources/types';
import type { MiddlewareFilter, MiddlewareInput, MiddlewareUpdateInput } from './types';
import { MiddlewareInUseError } from './types';

const nextMiddlewareId = makeIdFactory('middleware-new');
const nextAuditId = makeIdFactory('audit-middleware');

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
): AuditEntry {
  return {
    id: nextAuditId(),
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    resource_type: 'middleware',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier: 'write',
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useMiddlewareList(tenantId: string, filter: MiddlewareFilter): Middleware[] {
  const middlewares = useMockStore((s) => s.middlewares);
  const search = filter.search.toLowerCase().trim();

  const results: Middleware[] = [];
  for (const m of Object.values(middlewares)) {
    if (m.tenant_id !== tenantId) continue;
    if (filter.kind !== 'all' && m.kind !== filter.kind) continue;
    if (filter.enabled === 'enabled' && !m.enabled) continue;
    if (filter.enabled === 'disabled' && m.enabled) continue;
    if (search) {
      const nameMatch = m.name.toLowerCase().includes(search);
      const descMatch = m.description?.toLowerCase().includes(search) ?? false;
      if (!nameMatch && !descMatch) continue;
    }
    results.push(m);
  }
  // Stable display order: lower order_hint first; ties broken by id string compare
  results.sort((a, b) => {
    if (a.order_hint !== b.order_hint) return a.order_hint - b.order_hint;
    return a.id.localeCompare(b.id);
  });
  return results;
}

export function useMiddlewareDetail(id: string): Middleware | undefined {
  return useMockStore((s) => s.middlewares[id]);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createMiddleware(
  tenantId: string,
  input: MiddlewareInput,
): Promise<Middleware> {
  await simulateLatency('mutation');

  const id = nextMiddlewareId();
  const middleware: Middleware = {
    id,
    tenant_id: tenantId,
    name: input.name,
    kind: input.kind,
    config: input.config,
    enabled: input.enabled ?? true,
    order_hint: input.order_hint ?? 100,
    ...(input.description !== undefined ? { description: input.description } : {}),
    created_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('middlewares', middleware);
  state.appendAudit(makeAuditEntry(getCurrentActorId(), tenantId, 'middleware.create', id));
  emitHostEvent('middleware.created', {
    middleware_id: id,
    tenant_id: tenantId,
    kind: input.kind,
  });
  return middleware;
}

export async function updateMiddleware(
  id: string,
  input: MiddlewareUpdateInput,
): Promise<Middleware> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.middlewares[id];
  if (!current) throw new Error(`Middleware ${id} not found`);

  const patch: Partial<Middleware> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.description !== undefined) patch.description = input.description;
  if (input.config !== undefined) patch.config = input.config;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.order_hint !== undefined) patch.order_hint = input.order_hint;

  const before = { ...current };
  state.updateEntity('middlewares', id, patch);
  const updated = useMockStore.getState().middlewares[id];
  if (!updated) throw new Error(`Middleware ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), current.tenant_id, 'middleware.update', id),
    diff: { before, after: updated },
  });
  emitHostEvent('middleware.updated', {
    middleware_id: id,
    tenant_id: current.tenant_id,
  });
  return updated;
}

export async function deleteMiddleware(id: string): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const middleware = state.middlewares[id];
  if (!middleware) throw new Error(`Middleware ${id} not found`);

  const referencingRouteIds = Object.values(state.routes)
    .filter((r) => r.middleware_ids.includes(id))
    .map((r) => r.id);
  if (referencingRouteIds.length > 0) {
    throw new MiddlewareInUseError(referencingRouteIds);
  }

  state.deleteEntity('middlewares', id);
  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), middleware.tenant_id, 'middleware.delete', id),
    tier: 'destructive',
  });
  emitHostEvent('middleware.deleted', {
    middleware_id: id,
    tenant_id: middleware.tenant_id,
  });
}
