/**
 * Routes API — Stage 2: backed by Orval-generated TanStack Query hooks.
 *
 * This module replaces `api.ts` (mock-store backed) when `VITE_USE_MOCKS=false`
 * is set. It wraps the generated hooks with the routes adapter so consumers
 * still receive the admin `Route` type.
 *
 * ## Middleware reorder
 * Decision 003 RESOLVED. The dedicated endpoint
 * `PUT /api/v1/t/{tenant}/routes/{id}/middlewares/order` is wired and
 * called by `useReorderMiddlewaresMutation` / `reorderMiddlewaresReal`.
 * The daemon updates the `rioku.admin/middleware-ids` label and triggers
 * a Caddy reload (`route.middlewares.reorder`).
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
import { customFetch } from '@/api/mutator';
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

  const responseBody = (data as unknown as { data: ListRoutesBody } | undefined)?.data;
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
  const proto = (data as unknown as { data: V1Route }).data;
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
      const proto = (res as unknown as { data: V1Route }).data;
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
      const proto = (res as unknown as { data: V1Route }).data;
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
 * Decision 003 RESOLVED: dedicated endpoint added.
 *
 * `PUT /api/v1/t/{tenantId}/routes/{routeId}/middlewares/order`
 *
 * Body: `{ order: string[] }`. The daemon updates the
 * `rioku.admin/middleware-ids` label and triggers a Caddy reload.
 *
 * The hook is invoked by the drag-drop UI in `MiddlewareStackEditor` after
 * a sortable drop. Optimistic update is intentionally omitted — the UI
 * waits on the response so the new order rendered is the authoritative
 * one (no flicker on rollback).
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
    }): Promise<{ routeId: string; order: string[] }> => {
      const data = await reorderRouteMiddlewaresFetch(tenantId, routeId, middlewareIds);
      return { routeId, order: data.order };
    },
    onSuccess: (_data, { routeId }) => {
      void qc.invalidateQueries({ queryKey: getGetRouteQueryKey(tenantId, routeId) });
      void qc.invalidateQueries({ queryKey: getListRoutesQueryKey(tenantId) });
    },
  });
}

/**
 * Imperative wrapper around the dedicated reorder endpoint. Used by the
 * legacy `reorderMiddlewares(routeId, ids)` signature exposed from the
 * feature barrel.
 */
export async function reorderRouteMiddlewaresFetch(
  tenantId: string,
  routeId: string,
  order: string[],
): Promise<{ id: string; order: string[]; middlewareIds: string[] }> {
  return customFetch<{ id: string; order: string[]; middlewareIds: string[] }>({
    url: `/t/${encodeURIComponent(tenantId)}/routes/${encodeURIComponent(routeId)}/middlewares/order`,
    method: 'PUT',
    data: { order },
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

/** Imperative create — used by `features/routes/api.ts`. Prefer the
 * mutation hook inside React components. */
export async function createRouteReal(tenantId: string, input: RouteInput): Promise<Route> {
  const body = toProtoRouteBody(input);
  const res = await orvalCreateRoute(tenantId, body);
  const proto = (res as unknown as { data: V1Route }).data;
  return fromProtoRoute(proto, tenantId);
}

/** Imperative delete — used by `features/routes/api.ts`. */
export async function deleteRouteReal(tenantId: string, id: string): Promise<void> {
  await orvalDeleteRoute(tenantId, id);
}

/** Imperative policy attach — used by `features/routes/api.ts`. */
export async function attachPolicyReal(
  tenantId: string,
  routeId: string,
  policyId: string,
): Promise<void> {
  await orvalAttachPolicy(tenantId, routeId, policyId);
}

/** Imperative policy detach — used by `features/routes/api.ts`. */
export async function detachPolicyReal(
  tenantId: string,
  routeId: string,
  policyId: string,
): Promise<void> {
  await orvalDetachPolicy(tenantId, routeId, policyId);
}

/**
 * Reorder middlewares (imperative). Calls the dedicated reorder endpoint.
 * Used by `features/routes/api.ts`. Prefer `useReorderMiddlewaresMutation`
 * inside React components.
 */
export async function reorderMiddlewaresReal(
  tenantId: string,
  routeId: string,
  middlewareIds: string[],
): Promise<{ id: string; order: string[] }> {
  const data = await reorderRouteMiddlewaresFetch(tenantId, routeId, middlewareIds);
  return { id: data.id, order: data.order };
}
