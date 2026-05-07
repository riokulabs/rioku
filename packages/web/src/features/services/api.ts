/**
 * Services API — Stage 2 wiring.
 *
 * This module is the public services API surface. It is backed by the
 * Orval-generated TanStack Query hooks (see `api.stage2.ts` for the
 * underlying real-endpoint wrappers) so every component that imports from
 * `features/services` ends up calling the live daemon.
 *
 * Legacy hook signatures are preserved; imperative mutations require an
 * explicit `tenantId` because
 * the daemon REST surface is `/api/v1/t/{tenant}/services/{id}`. Callers
 * that previously invoked `deleteService(id)` must pass the tenant.
 */
import type { Route, Service } from '@/api/resources';
import { useRouteListReal } from '@/features/routes/api.stage2';
import { useServiceListReal, useServiceDetailReal } from './api.stage2';
import type { ServiceFilter, ServiceInput, ServiceUpdateInput } from './types';
import { ServiceInUseError } from './types';
import {
  createService as orvalCreateService,
  deleteService as orvalDeleteService,
  patchService,
  forceReloadService as orvalForceReloadService,
} from '@/api/generated/services/services';
import { fromProtoService, toProtoServiceBody, toProtoServicePatch } from './adapter';
import type { V1Service } from '@/api/generated/schemas';

// ─── Re-exports (real-endpoint mutation hooks) ────────────────────────────────
export {
  useServiceListReal,
  useServiceDetailReal,
  useCreateServiceMutation,
  useUpdateServiceMutation,
  useDeleteServiceMutation,
  useEnableServiceMutation,
  useDisableServiceMutation,
  useForceReloadServiceMutation,
} from './api.stage2';

// ─── Selectors (legacy shape — Service[] / Service) ───────────────────────────

/**
 * Returns services for a tenant, filtered by `filter`.
 * Wraps `useServiceListReal` and projects only the `services` array so legacy
 * call sites continue to compile. Loading/error state is available via
 * `useServiceListReal` for components that want richer UX.
 */
export function useServiceList(tenantId: string, filter: ServiceFilter): Service[] {
  return useServiceListReal(tenantId, filter).services;
}

/** Single-service hook. Requires tenantId because the daemon route is per-tenant. */
export function useServiceDetail(tenantId: string, serviceId: string): Service | undefined {
  return useServiceDetailReal(tenantId, serviceId);
}

/**
 * Returns routes attached to a given service via the real daemon endpoint.
 *
 * Signature change: stage-1 took only `serviceId`; stage-2 needs the tenant
 * because the listing endpoint is `/api/v1/t/{tenant}/routes`. Callers in
 * `components/{detail,full-page}.tsx` are updated.
 */
export function useServiceRoutes(tenantId: string, serviceId: string): Route[] {
  return useRouteListReal(tenantId, serviceId).routes;
}

// ─── Imperative mutations (real endpoints; tenantId required) ─────────────────

/** Create a service. Real endpoint: POST /api/v1/t/{tenantId}/services */
export async function createService(tenantId: string, input: ServiceInput): Promise<Service> {
  const body = toProtoServiceBody(input);
  const res = await orvalCreateService(tenantId, body);
  const proto = res as unknown as V1Service;
  return fromProtoService(proto, tenantId);
}

/** Update a service. Real endpoint: PATCH /api/v1/t/{tenantId}/services/{id} */
export async function updateService(
  tenantId: string,
  id: string,
  input: ServiceUpdateInput,
): Promise<Service> {
  const body = toProtoServicePatch(input);
  const res = await patchService(tenantId, id, body);
  const proto = res as unknown as V1Service;
  return fromProtoService(proto, tenantId);
}

/**
 * Delete a service. Real endpoint: DELETE /api/v1/t/{tenantId}/services/{id}
 *
 * Translates a 409 from the daemon (routes still reference the service)
 * into a `ServiceInUseError` carrying the offending route ids.
 */
export async function deleteService(tenantId: string, id: string): Promise<void> {
  try {
    await orvalDeleteService(tenantId, id);
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      (err as { status: number }).status === 409
    ) {
      const detail = err as { data?: { routeIds?: string[] } };
      throw new ServiceInUseError(detail.data?.routeIds ?? []);
    }
    throw err;
  }
}

/** Enable a service (clears the `disabled` admin label). */
export async function enableService(tenantId: string, id: string): Promise<void> {
  const body = toProtoServicePatch({ health: 'healthy' });
  await patchService(tenantId, id, body);
}

/** Disable a service (sets the `disabled` admin label). */
export async function disableService(tenantId: string, id: string): Promise<void> {
  const body = toProtoServicePatch({ health: 'disabled' });
  await patchService(tenantId, id, body);
}

/** Force-reload a service. Real endpoint: POST /api/v1/t/{tenantId}/services/{id}/force-reload */
export async function forceReloadService(tenantId: string, id: string): Promise<void> {
  await orvalForceReloadService(tenantId, id);
}

// Re-export the in-use error class so consumers can import from the barrel.
export { ServiceInUseError };
