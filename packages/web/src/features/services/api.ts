/**
 * Services API — backed by the Zustand mock store.
 *
 * Mirrors features/security/users/api.ts:
 *   - selectors pull raw Records, derive arrays outside the selector body
 *   - mutations call simulateLatency + appendAudit + emitHostEvent
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AuditEntry, Route, Service } from '@/api/resources';
import type { ServiceFilter, ServiceInput, ServiceUpdateInput } from './types';
import { ServiceInUseError } from './types';

const nextServiceId = makeIdFactory('service-new');
const nextAuditId = makeIdFactory('audit-service');

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
    resource_type: 'service',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier: 'write',
  };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Returns services for a tenant, filtered by `filter`.
 * Selector returns raw record; filter/derivation happens in the hook body so
 * the returned array reference updates only when input changes.
 */
export function useServiceList(tenantId: string, filter: ServiceFilter): Service[] {
  const services = useMockStore((s) => s.services);

  const search = filter.search.toLowerCase().trim();

  const results: Service[] = [];
  for (const service of Object.values(services)) {
    if (service.tenant_id !== tenantId) continue;
    if (filter.health.length > 0 && !filter.health.includes(service.health)) continue;
    if (filter.env.length > 0 && !filter.env.includes(service.env)) continue;
    if (filter.tags.length > 0 && !filter.tags.some((t) => service.tags.includes(t))) {
      continue;
    }
    if (search) {
      const nameMatch = service.name.toLowerCase().includes(search);
      const descMatch = service.description?.toLowerCase().includes(search) ?? false;
      const upstreamMatch = service.upstream.toLowerCase().includes(search);
      if (!nameMatch && !descMatch && !upstreamMatch) continue;
    }
    results.push(service);
  }
  return results;
}

/** Return a single service by ID. */
export function useServiceDetail(serviceId: string): Service | undefined {
  return useMockStore((s) => s.services[serviceId]);
}

/** Return all routes attached to a service. */
export function useServiceRoutes(serviceId: string): Route[] {
  const routes = useMockStore((s) => s.routes);
  return Object.values(routes).filter((r) => r.service_id === serviceId);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createService(tenantId: string, input: ServiceInput): Promise<Service> {
  await simulateLatency('mutation');

  const id = nextServiceId();
  const service: Service = {
    id,
    tenant_id: tenantId,
    name: input.name,
    upstream: input.upstream,
    upstream_protocol: input.upstream_protocol,
    env: input.env,
    health: 'healthy',
    tags: input.tags ?? [],
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.health_check !== undefined ? { health_check: input.health_check } : {}),
    created_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('services', service);
  state.appendAudit(makeAuditEntry(getCurrentActorId(), tenantId, 'service.create', id));
  emitHostEvent('service.created', { service_id: id, tenant_id: tenantId });
  return service;
}

export async function updateService(id: string, input: ServiceUpdateInput): Promise<Service> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.services[id];
  if (!current) {
    throw new Error(`Service ${id} not found`);
  }

  const patch: Partial<Service> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.upstream !== undefined) patch.upstream = input.upstream;
  if (input.upstream_protocol !== undefined) patch.upstream_protocol = input.upstream_protocol;
  if (input.env !== undefined) patch.env = input.env;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.health_check !== undefined) patch.health_check = input.health_check;
  if (input.health !== undefined) patch.health = input.health;

  const before = { ...current };
  state.updateEntity('services', id, patch);
  const updated = useMockStore.getState().services[id];
  if (!updated) throw new Error(`Service ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), current.tenant_id, 'service.update', id),
    diff: { before, after: updated },
  });
  emitHostEvent('service.updated', { service_id: id, tenant_id: current.tenant_id });
  return updated;
}

export async function deleteService(id: string): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const service = state.services[id];
  if (!service) {
    throw new Error(`Service ${id} not found`);
  }

  const referencingRouteIds = Object.values(state.routes)
    .filter((r) => r.service_id === id)
    .map((r) => r.id);
  if (referencingRouteIds.length > 0) {
    throw new ServiceInUseError(referencingRouteIds);
  }

  state.deleteEntity('services', id);
  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), service.tenant_id, 'service.delete', id),
    tier: 'destructive',
  });
  emitHostEvent('service.deleted', { service_id: id, tenant_id: service.tenant_id });
}

export async function enableService(id: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const service = state.services[id];
  if (!service) {
    throw new Error(`Service ${id} not found`);
  }

  state.updateEntity('services', id, { health: 'healthy' });
  state.appendAudit(makeAuditEntry(getCurrentActorId(), service.tenant_id, 'service.enable', id));
  emitHostEvent('service.updated', { service_id: id, tenant_id: service.tenant_id });
}

export async function disableService(id: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const service = state.services[id];
  if (!service) {
    throw new Error(`Service ${id} not found`);
  }

  state.updateEntity('services', id, { health: 'disabled' });
  state.appendAudit(makeAuditEntry(getCurrentActorId(), service.tenant_id, 'service.disable', id));
  emitHostEvent('service.updated', { service_id: id, tenant_id: service.tenant_id });
}

export async function forceReloadService(id: string): Promise<void> {
  await simulateLatency('mutation');
  const state = useMockStore.getState();
  const service = state.services[id];
  if (!service) {
    throw new Error(`Service ${id} not found`);
  }

  state.updateEntity('services', id, { last_reloaded_at: now() });
  state.appendAudit(makeAuditEntry(getCurrentActorId(), service.tenant_id, 'service.reload', id));
  emitHostEvent('service.reloaded', {
    service_id: id,
    tenant_id: service.tenant_id,
  });
}
