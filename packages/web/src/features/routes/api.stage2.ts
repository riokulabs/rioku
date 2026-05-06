/**
 * Routes API — Stage 2: backed by Orval-generated TanStack Query hooks.
 *
 * This module replaces `api.ts` (mock-store backed) when `VITE_USE_MOCKS=false`
 * is set. It wraps the generated hooks with the routes adapter so consumers
 * still receive the admin `Route` type.
 *
 * ## Middleware reorder
 * The `reorderMiddlewares` function (Decision 003) has no dedicated daemon
 * endpoint yet. Until `PUT .../routes/{id}/middlewares/order` is added, reorder
 * is implemented as a `PATCH /routes/{id}` with the full `middleware_ids` array
 * stored in the `rioku.admin/middleware-ids` label. See Decision 003 for tracking.
 *
 * ## Policy attach/detach
 * The generated `attachPolicyToRoute` and `detachPolicyFromRoute` hooks are
 * used directly — no adapter needed as they use route ID + policy ID.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listRoutes,
  getRoute,
  createRoute as orvalCreateRoute,
  deleteRoute as orvalDeleteRoute,
  patchRoute,
  attachPolicyToRoute as orvalAttachPolicy,
  detachPolicyFromRoute as orvalDetachPolicy,
  listPoliciesByRoute as orvalListPoliciesByRoute,
  getListRoutesQueryKey,
  getGetRouteQueryKey,
  getListPoliciesByRouteQueryKey,
} from '@/api/generated/routes/routes';
import type { V1Route } from '@/api/generated/schemas';
import type { Route } from '@/api/resources';
import type { RouteFilter, RouteInput, RouteUpdateInput } from './types';
import { fromProtoRoute, toProtoRouteBody, toProtoRoutePatch } from './adapter';

// customFetch runtime note: the generated typed wrapper (listRoutesResponse etc.)
// has { data, status, headers } but customFetch returns JSON body directly.
// We cast via `as unknown as` where needed.

interface ListRoutesBody {
  items?: V1Route[];
  total?: number;
}

// ─── Query hooks ──────────────────────────────────────────────────────────────

/**
 * List routes for a tenant/service with client-side filter applied.
 */
export function useRouteListReal(
  tenantId: string,
  serviceId: string | undefined,
  filter?: RouteFilter,
): {
  routes: Route[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: getListRoutesQueryKey(tenantId),
    queryFn: ({ signal }) => listRoutes(tenantId, { signal }),
    enabled: Boolean(tenantId),
  });

  const responseBody = data as unknown as ListRoutesBody | undefined;
  const allRoutes: Route[] =
    responseBody?.items?.map((proto) => fromProtoRoute(proto, tenantId)) ?? [];

  const search = filter?.search.toLowerCase().trim() ?? '';
  const routes = allRoutes.filter((rt) => {
    if (serviceId !== undefined && rt.service_id !== serviceId) return false;
    if (filter?.method && filter.method !== 'all' && rt.method !== filter.method) return false;
    if (filter?.enabled === 'enabled' && !rt.enabled) return false;
    if (filter?.enabled === 'disabled' && rt.enabled) return false;
    if (search) {
      const nameMatch = rt.name.toLowerCase().includes(search);
      const pathMatch = rt.path.toLowerCase().includes(search);
      if (!nameMatch && !pathMatch) return false;
    }
    return true;
  });

  return { routes, isLoading, isError, error };
}

/** Get a single route by ID. */
export function useRouteDetailReal(
  tenantId: string,
  routeId: string,
): Route | undefined {
  const { data } = useQuery({
    queryKey: getGetRouteQueryKey(tenantId, routeId),
    queryFn: ({ signal }) => getRoute(tenantId, routeId, { signal }),
    enabled: Boolean(tenantId) && Boolean(routeId),
  });
  if (!data) return undefined;
  const proto = data as unknown as V1Route;
  return fromProtoRoute(proto, tenantId);
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

/** Create route mutation. */
export function useCreateRouteMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RouteInput): Promise<Route> => {
      const body = toProtoRouteBody(input);
      const res = await orvalCreateRoute(tenantId, body);
      const proto = res as unknown as V1Route;
      if (!proto) throw new Error('Server returned empty route');
      return fromProtoRoute(proto, tenantId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListRoutesQueryKey(tenantId) });
    },
  });
}

/** Update (patch) route mutation. */
export function useUpdateRouteMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: RouteUpdateInput }): Promise<Route> => {
      const body = toProtoRoutePatch(input);
      const res = await patchRoute(tenantId, id, body);
      const proto = res as unknown as V1Route;
      if (!proto) throw new Error('Server returned empty route');
      return fromProtoRoute(proto, tenantId);
    },
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: getListRoutesQueryKey(tenantId) });
      void qc.invalidateQueries({ queryKey: getGetRouteQueryKey(tenantId, id) });
    },
  });
}

/** Delete route mutation. */
export function useDeleteRouteMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await orvalDeleteRoute(tenantId, id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListRoutesQueryKey(tenantId) });
    },
  });
}

/**
 * Reorder middlewares on a route.
 *
 * Decision 003: No dedicated `PUT .../middlewares/order` endpoint exists.
 * This uses `PATCH /routes/{id}` with the ordered `middleware_ids` list
 * encoded in the `rioku.admin/middleware-ids` label.
 */
export function useReorderMiddlewaresMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      routeId,
      middlewareIds,
    }: {
      routeId: string;
      middlewareIds: string[];
    }): Promise<Route> => {
      const body = toProtoRoutePatch({ middleware_ids: middlewareIds });
      const res = await patchRoute(tenantId, routeId, body);
      const proto = res as unknown as V1Route;
      if (!proto) throw new Error('Server returned empty route');
      return fromProtoRoute(proto, tenantId);
    },
    onSuccess: (_data, { routeId }) => {
      void qc.invalidateQueries({ queryKey: getGetRouteQueryKey(tenantId, routeId) });
      void qc.invalidateQueries({ queryKey: getListRoutesQueryKey(tenantId) });
    },
  });
}

/** Attach policy to route. */
export function useAttachPolicyMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ routeId, policyId }: { routeId: string; policyId: string }): Promise<void> => {
      await orvalAttachPolicy(tenantId, routeId, policyId);
    },
    onSuccess: (_data, { routeId }) => {
      void qc.invalidateQueries({ queryKey: getGetRouteQueryKey(tenantId, routeId) });
      void qc.invalidateQueries({ queryKey: getListPoliciesByRouteQueryKey(tenantId, routeId) });
    },
  });
}

/** Detach policy from route. */
export function useDetachPolicyMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ routeId, policyId }: { routeId: string; policyId: string }): Promise<void> => {
      await orvalDetachPolicy(tenantId, routeId, policyId);
    },
    onSuccess: (_data, { routeId }) => {
      void qc.invalidateQueries({ queryKey: getGetRouteQueryKey(tenantId, routeId) });
      void qc.invalidateQueries({ queryKey: getListPoliciesByRouteQueryKey(tenantId, routeId) });
    },
  });
}

/** List policies attached to a route (by route ID). */
export function useListRoutePoliciesReal(tenantId: string, routeId: string) {
  return useQuery({
    queryKey: getListPoliciesByRouteQueryKey(tenantId, routeId),
    queryFn: ({ signal }) => orvalListPoliciesByRoute(tenantId, routeId, { signal }),
    enabled: Boolean(tenantId) && Boolean(routeId),
  });
}

// ─── Imperative wrappers (matches api.ts signature contract) ──────────────────

/** @deprecated Prefer `useCreateRouteMutation` for React components. */
export async function createRouteReal(tenantId: string, input: RouteInput): Promise<Route> {
  const body = toProtoRouteBody(input);
  const res = await orvalCreateRoute(tenantId, body);
  if (!res.data) throw new Error('Server returned empty route');
  return fromProtoRoute(res.data, tenantId);
}

/** @deprecated Prefer `useDeleteRouteMutation` for React components. */
export async function deleteRouteReal(tenantId: string, id: string): Promise<void> {
  await orvalDeleteRoute(tenantId, id);
}

/** @deprecated Prefer `useAttachPolicyMutation` for React components. */
export async function attachPolicyReal(
  tenantId: string,
  routeId: string,
  policyId: string,
): Promise<void> {
  await orvalAttachPolicy(tenantId, routeId, policyId);
}

/** @deprecated Prefer `useDetachPolicyMutation` for React components. */
export async function detachPolicyReal(
  tenantId: string,
  routeId: string,
  policyId: string,
): Promise<void> {
  await orvalDetachPolicy(tenantId, routeId, policyId);
}

/**
 * Reorder middlewares (imperative).
 * @deprecated Prefer `useReorderMiddlewaresMutation` for React components.
 */
export async function reorderMiddlewaresReal(
  tenantId: string,
  routeId: string,
  middlewareIds: string[],
): Promise<Route> {
  const body = toProtoRoutePatch({ middleware_ids: middlewareIds });
  const res = await patchRoute(tenantId, routeId, body);
  if (!res.data) throw new Error('Server returned empty route');
  return fromProtoRoute(res.data, tenantId);
}
