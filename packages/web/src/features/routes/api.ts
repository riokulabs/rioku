/**
 * Routes API — backed by the Zustand mock store.
 * Mirrors features/services/api.ts pattern.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import { emitHostEvent } from '@/host/events';
import type { AuditEntry, Route } from '@/api/resources/types';
import type { RouteFilter, RouteInput, RouteUpdateInput } from './types';

const nextRouteId = makeIdFactory('route-new');
const nextAuditId = makeIdFactory('audit-route');

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
    resource_type: 'route',
    ...(resourceId ? { resource_id: resourceId } : {}),
    outcome: 'success',
    at: now(),
    tier: 'write',
  };
}

function resolveTenantIdForServiceId(serviceId: string): string | null {
  const state = useMockStore.getState();
  return state.services[serviceId]?.tenant_id ?? null;
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * List routes. If `serviceId` is supplied, filter to that service; otherwise
 * return every route belonging to the given tenant (resolved via service).
 */
export function useRouteList(
  serviceId: string | undefined,
  tenantId: string,
  filter?: RouteFilter,
): Route[] {
  const routes = useMockStore((s) => s.routes);
  const services = useMockStore((s) => s.services);

  const search = filter?.search.toLowerCase().trim() ?? '';
  const methodFilter = filter?.method ?? 'all';
  const enabledFilter = filter?.enabled ?? 'all';

  const results: Route[] = [];
  for (const route of Object.values(routes)) {
    if (serviceId !== undefined) {
      if (route.service_id !== serviceId) continue;
    } else {
      const svc = services[route.service_id];
      if (svc?.tenant_id !== tenantId) continue;
    }

    if (methodFilter !== 'all' && route.method !== methodFilter) continue;
    if (enabledFilter === 'enabled' && !route.enabled) continue;
    if (enabledFilter === 'disabled' && route.enabled) continue;
    if (search) {
      const nameMatch = route.name.toLowerCase().includes(search);
      const pathMatch = route.path.toLowerCase().includes(search);
      if (!nameMatch && !pathMatch) continue;
    }
    results.push(route);
  }
  return results;
}

export function useRouteDetail(routeId: string): Route | undefined {
  return useMockStore((s) => s.routes[routeId]);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createRoute(input: RouteInput): Promise<Route> {
  await simulateLatency('mutation');

  const tenantId = resolveTenantIdForServiceId(input.service_id);

  const id = nextRouteId();
  const route: Route = {
    id,
    service_id: input.service_id,
    name: input.name,
    path: input.path,
    method: input.method,
    match_kind: input.match_kind,
    strip_prefix: input.strip_prefix ?? false,
    ...(input.rewrite_path !== undefined ? { rewrite_path: input.rewrite_path } : {}),
    headers_add: input.headers_add ?? {},
    headers_remove: input.headers_remove ?? [],
    policies: input.policies ?? [],
    middleware_ids: input.middleware_ids ?? [],
    enabled: input.enabled ?? true,
    created_at: now(),
    updated_at: now(),
  };

  const state = useMockStore.getState();
  state.addEntity('routes', route);
  state.appendAudit(makeAuditEntry(getCurrentActorId(), tenantId, 'route.create', id));
  emitHostEvent('route.created', { route_id: id, service_id: input.service_id });
  return route;
}

export async function updateRoute(
  id: string,
  input: RouteUpdateInput,
): Promise<Route> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const current = state.routes[id];
  if (!current) throw new Error(`Route ${id} not found`);

  const patch: Partial<Route> = { updated_at: now() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.path !== undefined) patch.path = input.path;
  if (input.method !== undefined) patch.method = input.method;
  if (input.match_kind !== undefined) patch.match_kind = input.match_kind;
  if (input.strip_prefix !== undefined) patch.strip_prefix = input.strip_prefix;
  if (input.rewrite_path !== undefined) patch.rewrite_path = input.rewrite_path;
  if (input.headers_add !== undefined) patch.headers_add = input.headers_add;
  if (input.headers_remove !== undefined) patch.headers_remove = input.headers_remove;
  if (input.policies !== undefined) patch.policies = input.policies;
  if (input.middleware_ids !== undefined) patch.middleware_ids = input.middleware_ids;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const tenantId = resolveTenantIdForServiceId(current.service_id);
  const before = { ...current };
  state.updateEntity('routes', id, patch);
  const updated = useMockStore.getState().routes[id];
  if (!updated) throw new Error(`Route ${id} vanished mid-update`);

  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), tenantId, 'route.update', id),
    diff: { before, after: updated },
  });
  emitHostEvent('route.updated', { route_id: id, service_id: updated.service_id });
  return updated;
}

export async function deleteRoute(id: string): Promise<void> {
  await simulateLatency('mutation');

  const state = useMockStore.getState();
  const route = state.routes[id];
  if (!route) throw new Error(`Route ${id} not found`);

  const tenantId = resolveTenantIdForServiceId(route.service_id);
  state.deleteEntity('routes', id);
  state.appendAudit({
    ...makeAuditEntry(getCurrentActorId(), tenantId, 'route.delete', id),
    tier: 'destructive',
  });
  emitHostEvent('route.deleted', { route_id: id, service_id: route.service_id });
}

export async function attachPolicy(
  routeId: string,
  policyId: string,
): Promise<void> {
  await simulateLatency('mutation');

  useMockStore.setState((state) => {
    const route = state.routes[routeId];
    if (!route) return state;
    if (route.policies.includes(policyId)) return state;
    return {
      routes: {
        ...state.routes,
        [routeId]: { ...route, policies: [...route.policies, policyId], updated_at: now() },
      },
    };
  });

  const state = useMockStore.getState();
  const route = state.routes[routeId];
  const tenantId = route ? resolveTenantIdForServiceId(route.service_id) : null;
  state.appendAudit({
    ...makeAuditEntry(
      getCurrentActorId(),
      tenantId,
      'route.policy.attach',
      routeId,
    ),
    payload: { policy_id: policyId },
  });
  emitHostEvent('route.policy.attached', { route_id: routeId, policy_id: policyId });
}

export async function detachPolicy(
  routeId: string,
  policyId: string,
): Promise<void> {
  await simulateLatency('mutation');

  useMockStore.setState((state) => {
    const route = state.routes[routeId];
    if (!route) return state;
    if (!route.policies.includes(policyId)) return state;
    return {
      routes: {
        ...state.routes,
        [routeId]: {
          ...route,
          policies: route.policies.filter((p) => p !== policyId),
          updated_at: now(),
        },
      },
    };
  });

  const state = useMockStore.getState();
  const route = state.routes[routeId];
  const tenantId = route ? resolveTenantIdForServiceId(route.service_id) : null;
  state.appendAudit({
    ...makeAuditEntry(
      getCurrentActorId(),
      tenantId,
      'route.policy.detach',
      routeId,
    ),
    payload: { policy_id: policyId },
  });
  emitHostEvent('route.policy.detached', { route_id: routeId, policy_id: policyId });
}

/** Full-replace semantics for the middleware stack. */
export async function reorderMiddlewares(
  routeId: string,
  middlewareIds: string[],
): Promise<void> {
  await simulateLatency('mutation');

  let before: string[] = [];
  useMockStore.setState((state) => {
    const route = state.routes[routeId];
    if (!route) return state;
    before = [...route.middleware_ids];
    return {
      routes: {
        ...state.routes,
        [routeId]: { ...route, middleware_ids: [...middlewareIds], updated_at: now() },
      },
    };
  });

  const state = useMockStore.getState();
  const route = state.routes[routeId];
  const tenantId = route ? resolveTenantIdForServiceId(route.service_id) : null;
  state.appendAudit({
    ...makeAuditEntry(
      getCurrentActorId(),
      tenantId,
      'route.middlewares.reorder',
      routeId,
    ),
    diff: { before: { middleware_ids: before }, after: { middleware_ids: middlewareIds } },
  });
  emitHostEvent('route.middlewares.reordered', {
    route_id: routeId,
    middleware_ids: middlewareIds,
  });
}
