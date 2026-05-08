/**
 * Services API — Stage 2: backed by Orval-generated TanStack Query hooks.
 *
 * This module replaces `api.ts` (mock-store backed) when `VITE_USE_MOCKS=false`
 * is set. It wraps the generated `useListServices`, `useGetService`,
 * `usePatchService`, `useDeleteService`, and `useForceReloadService` hooks
 * with the services adapter so that consumers still receive the admin `Service`
 * type rather than the raw `V1Service` proto shape.
 *
 * ## Usage
 * Import from `features/services` as usual — the barrel `index.ts` will be
 * updated to re-export from this file instead of `api.ts` once the mode-flip
 * is confirmed to be safe.
 *
 * ## Adapter convention
 * See `adapter.ts` for the label-based admin metadata convention (env, tags,
 * protocol, health derived from upstream health checks). Decision 001 tracks
 * the final resolution for the schema mismatch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listServices,
  getService,
  createService as orvalCreateService,
  deleteService as orvalDeleteService,
  patchService,
  forceReloadService as orvalForceReloadService,
  getListServicesQueryKey,
  getGetServiceQueryKey,
} from '@/api/generated/services/services';
import type { ListServices200, V1Service } from '@/api/generated/schemas';
import type { Service } from '@/api/resources';
import type { ServiceFilter, ServiceInput, ServiceUpdateInput } from './types';
import { ServiceInUseError } from './types';
import { fromProtoService, toProtoServiceBody, toProtoServicePatch } from './adapter';

// ─── Query hooks ──────────────────────────────────────────────────────────────

/**
 * List services for a tenant with client-side filter applied.
 * Adapts V1Service[] → Service[].
 */
export function useServiceListReal(
  tenantId: string,
  filter: ServiceFilter,
): {
  services: Service[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: getListServicesQueryKey(tenantId),
    queryFn: ({ signal }) => listServices(tenantId, { signal }),
    enabled: Boolean(tenantId),
  });

  // customFetch returns the Orval wrapper {data, status, headers}; unwrap.
  const responseBody = (data as unknown as { data: ListServices200 } | undefined)?.data;
  const allServices: Service[] =
    responseBody?.items?.map((proto) => fromProtoService(proto, tenantId)) ?? [];

  // Client-side filter (mirrors mock implementation)
  const search = filter.search.toLowerCase().trim();
  const services = allServices.filter((svc) => {
    if (filter.health.length > 0 && !filter.health.includes(svc.health)) return false;
    if (filter.env.length > 0 && !filter.env.includes(svc.env)) return false;
    if (filter.tags.length > 0 && !filter.tags.some((t) => svc.tags.includes(t))) return false;
    if (search) {
      const nameMatch = svc.name.toLowerCase().includes(search);
      const descMatch = svc.description?.toLowerCase().includes(search) ?? false;
      const upstreamMatch = svc.upstream.toLowerCase().includes(search);
      if (!nameMatch && !descMatch && !upstreamMatch) return false;
    }
    return true;
  });

  return { services, isLoading, isError, error };
}

/**
 * Get a single service by ID.
 * Adapts V1Service → Service.
 */
export function useServiceDetailReal(tenantId: string, serviceId: string): Service | undefined {
  const { data } = useQuery({
    queryKey: getGetServiceQueryKey(tenantId, serviceId),
    queryFn: ({ signal }) => getService(tenantId, serviceId, { signal }),
    enabled: Boolean(tenantId) && Boolean(serviceId),
  });
  if (!data) return undefined;
  // customFetch returns the Orval wrapper {data, status, headers}; unwrap.
  const proto = (data as unknown as { data: V1Service }).data;
  return fromProtoService(proto, tenantId);
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

/**
 * Create service mutation backed by the real daemon endpoint.
 * Returns a TanStack Query mutation. Invalidates the list on success.
 */
export function useCreateServiceMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServiceInput): Promise<Service> => {
      const body = toProtoServiceBody(input);
      const res = await orvalCreateService(tenantId, body);
      const proto = (res as unknown as { data: V1Service }).data;
      return fromProtoService(proto, tenantId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListServicesQueryKey(tenantId) });
    },
  });
}

/**
 * Update (patch) service mutation backed by the real daemon endpoint.
 */
export function useUpdateServiceMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: ServiceUpdateInput;
    }): Promise<Service> => {
      const body = toProtoServicePatch(input);
      const res = await patchService(tenantId, id, body);
      const proto = (res as unknown as { data: V1Service }).data;
      return fromProtoService(proto, tenantId);
    },
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: getListServicesQueryKey(tenantId) });
      void qc.invalidateQueries({ queryKey: getGetServiceQueryKey(tenantId, id) });
    },
  });
}

/**
 * Delete service mutation. The daemon returns 409 if routes reference it;
 * this is translated to a `ServiceInUseError` with the referring route IDs
 * extracted from the error response body.
 */
export function useDeleteServiceMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await orvalDeleteService(tenantId, id);
      } catch (err: unknown) {
        // Daemon returns 409 when routes still reference this service.
        // Body: { title: "service in use", routeIds: [...] }
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
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListServicesQueryKey(tenantId) });
    },
  });
}

/**
 * Enable service: patches health label to clear the disabled flag.
 */
export function useEnableServiceMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const body = toProtoServicePatch({ health: 'healthy' });
      await patchService(tenantId, id, body);
    },
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: getListServicesQueryKey(tenantId) });
      void qc.invalidateQueries({ queryKey: getGetServiceQueryKey(tenantId, id) });
    },
  });
}

/**
 * Disable service: patches health label to set the disabled flag.
 */
export function useDisableServiceMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const body = toProtoServicePatch({ health: 'disabled' });
      await patchService(tenantId, id, body);
    },
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: getListServicesQueryKey(tenantId) });
      void qc.invalidateQueries({ queryKey: getGetServiceQueryKey(tenantId, id) });
    },
  });
}

/**
 * Force-reload service.
 * Note: daemon-side is a stub in v1 (see Decision 005). The endpoint acknowledges
 * the request but does NOT currently trigger a real Caddy config reload.
 */
export function useForceReloadServiceMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await orvalForceReloadService(tenantId, id);
    },
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: getGetServiceQueryKey(tenantId, id) });
    },
  });
}

// ─── Imperative wrappers (matches api.ts signature contract) ──────────────────
// These allow gradual adoption: callers that use `await createService(...)` style
// can call these without converting to mutation hooks.

/**
 * Imperative create service — wraps the Orval call directly.
 * @deprecated Prefer `useCreateServiceMutation` for React components.
 */
export async function createServiceReal(tenantId: string, input: ServiceInput): Promise<Service> {
  const body = toProtoServiceBody(input);
  const res = await orvalCreateService(tenantId, body);
  const proto = (res as unknown as { data: V1Service }).data;
  return fromProtoService(proto, tenantId);
}

/**
 * Imperative delete service — wraps the Orval call directly.
 * @deprecated Prefer `useDeleteServiceMutation` for React components.
 */
export async function deleteServiceReal(tenantId: string, id: string): Promise<void> {
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

/**
 * Imperative force-reload service.
 * @deprecated Prefer `useForceReloadServiceMutation` for React components.
 */
export async function forceReloadServiceReal(tenantId: string, id: string): Promise<void> {
  await orvalForceReloadService(tenantId, id);
}
