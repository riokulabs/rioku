/**
 * Routes API — Stage 2 wiring.
 *
 * This module is the public routes API surface. It is backed by the
 * Orval-generated TanStack Query hooks (see `api.stage2.ts` for the
 * underlying real-endpoint wrappers) so every component that imports from
 * `features/routes` ends up calling the live daemon.
 *
 * ## Tenant ID is required
 * The daemon REST surface is `/api/v1/t/{tenant}/routes`, so all
 * mutations now take an explicit `tenantId`. Stage-1 imperative wrappers
 * that took no tenant have been retired; call sites read the tenant slug
 * from the URL via `useParams({ from: '/t/$tenant' })`.
 *
 * ## Middleware reorder (Decision 003 RESOLVED)
 * `reorderMiddlewares(tenantId, routeId, ids)` calls the dedicated
 * endpoint `PUT /api/v1/t/{tenant}/routes/{id}/middlewares/order`.
 *
 * @see ./api.stage2.ts
 */

import {
  useRouteListReal,
  useRouteDetailReal,
  createRouteReal,
  deleteRouteReal,
  attachPolicyReal,
  detachPolicyReal,
  reorderMiddlewaresReal,
} from './api.stage2';
import { patchRoute } from '@/api/generated/routes/routes';
import { fromProtoRoute, toProtoRoutePatch } from './adapter';
import type { V1Route } from '@/api/generated/schemas';
import type { Route } from '@/api/resources';
import type { RouteFilter, RouteInput, RouteUpdateInput } from './types';

// ─── Re-exports (real-endpoint hooks) ─────────────────────────────────────────
export {
  useRouteListReal,
  useRouteDetailReal,
  useCreateRouteMutation,
  useUpdateRouteMutation,
  useDeleteRouteMutation,
  useAttachPolicyMutation,
  useDetachPolicyMutation,
  useReorderMiddlewaresMutation,
  useListRoutePoliciesReal,
} from './api.stage2';

// ─── Selectors (legacy shape — Route[] / Route) ───────────────────────────────

/**
 * Returns routes for a tenant (optionally filtered to a single service).
 * Wraps `useRouteListReal` and projects only the `routes` array so legacy
 * call sites continue to compile. Loading / error state is available via
 * `useRouteListReal` for components that want richer UX.
 */
export function useRouteList(
  serviceId: string | undefined,
  tenantId: string,
  filter?: RouteFilter,
): Route[] {
  return useRouteListReal(tenantId, serviceId, filter).routes;
}

/** Single-route hook. Requires tenantId because the daemon route is per-tenant. */
export function useRouteDetail(tenantId: string, routeId: string): Route | undefined {
  return useRouteDetailReal(tenantId, routeId);
}

// ─── Imperative mutations (real endpoints; tenantId required) ─────────────────

/** Create a route. Real endpoint: POST /api/v1/t/{tenantId}/routes */
export async function createRoute(tenantId: string, input: RouteInput): Promise<Route> {
  return createRouteReal(tenantId, input);
}

/** Update a route. Real endpoint: PATCH /api/v1/t/{tenantId}/routes/{id} */
export async function updateRoute(
  tenantId: string,
  id: string,
  input: RouteUpdateInput,
): Promise<Route> {
  const body = toProtoRoutePatch(input);
  const res = await patchRoute(tenantId, id, body);
  const proto = res as unknown as V1Route;
  return fromProtoRoute(proto, tenantId);
}

/** Delete a route. Real endpoint: DELETE /api/v1/t/{tenantId}/routes/{id} */
export async function deleteRoute(tenantId: string, id: string): Promise<void> {
  return deleteRouteReal(tenantId, id);
}

/** Attach a policy to a route. */
export async function attachPolicy(
  tenantId: string,
  routeId: string,
  policyId: string,
): Promise<void> {
  return attachPolicyReal(tenantId, routeId, policyId);
}

/** Detach a policy from a route. */
export async function detachPolicy(
  tenantId: string,
  routeId: string,
  policyId: string,
): Promise<void> {
  return detachPolicyReal(tenantId, routeId, policyId);
}

/**
 * Replace the route's middleware stack with the supplied ordered list.
 * Calls the dedicated reorder endpoint.
 */
export async function reorderMiddlewares(
  tenantId: string,
  routeId: string,
  middlewareIds: string[],
): Promise<void> {
  await reorderMiddlewaresReal(tenantId, routeId, middlewareIds);
}
