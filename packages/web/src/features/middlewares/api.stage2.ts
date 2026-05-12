/**
 * Middlewares API — Stage 2: backed by Orval-generated TanStack Query hooks.
 *
 * Activated when `VITE_USE_MOCKS=false`. Replaces the mock-store backed
 * hooks in `api.ts` with thin wrappers around the generated client.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listMiddlewares,
  getMiddleware,
  createMiddleware as orvalCreateMiddleware,
  patchMiddleware,
  deleteMiddleware as orvalDeleteMiddleware,
  getListMiddlewaresQueryKey,
  getGetMiddlewareQueryKey,
} from '@/api/generated/middlewares/middlewares';
import type { ListMiddlewares200, Middleware as ProtoMiddleware } from '@/api/generated/schemas';
import type { Middleware } from '@/api/resources';
import type { MiddlewareFilter, MiddlewareInput, MiddlewareUpdateInput } from './types';
import { fromProtoMiddleware, toProtoMiddlewareCreate, toProtoMiddlewarePatch } from './adapter';

// ─── Query hooks ──────────────────────────────────────────────────────────────

export function useMiddlewareListReal(
  tenantId: string,
  filter: MiddlewareFilter,
): {
  middlewares: Middleware[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: getListMiddlewaresQueryKey(tenantId),
    queryFn: ({ signal }) => listMiddlewares(tenantId, { signal }),
    enabled: Boolean(tenantId),
  });

  const body = (data as unknown as { data: ListMiddlewares200 } | undefined)?.data;
  const all: Middleware[] = body?.items?.map((p) => fromProtoMiddleware(p, tenantId)) ?? [];

  const search = filter.search.toLowerCase().trim();
  const middlewares = all.filter((m) => {
    if (filter.kind !== 'all' && m.kind !== filter.kind) return false;
    if (filter.enabled === 'enabled' && !m.enabled) return false;
    if (filter.enabled === 'disabled' && m.enabled) return false;
    if (search) {
      const nameMatch = m.name.toLowerCase().includes(search);
      const descMatch = m.description?.toLowerCase().includes(search) ?? false;
      if (!nameMatch && !descMatch) return false;
    }
    return true;
  });

  middlewares.sort((a, b) => {
    if (a.order_hint !== b.order_hint) return a.order_hint - b.order_hint;
    return a.id.localeCompare(b.id);
  });

  return { middlewares, isLoading, isError, error };
}

export function useMiddlewareDetailReal(tenantId: string, id: string): Middleware | undefined {
  const { data } = useQuery({
    queryKey: getGetMiddlewareQueryKey(tenantId, id),
    queryFn: ({ signal }) => getMiddleware(tenantId, id, { signal }),
    enabled: Boolean(tenantId) && Boolean(id),
  });
  if (!data) return undefined;
  const proto = (data as unknown as { data: ProtoMiddleware }).data;
  return fromProtoMiddleware(proto, tenantId);
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

export function useCreateMiddlewareMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MiddlewareInput): Promise<Middleware> => {
      const body = toProtoMiddlewareCreate(input);
      const res = (await orvalCreateMiddleware(tenantId, body)) as unknown as {
        data: ProtoMiddleware;
      };
      return fromProtoMiddleware(res.data, tenantId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListMiddlewaresQueryKey(tenantId) });
    },
  });
}

export function useUpdateMiddlewareMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; input: MiddlewareUpdateInput }): Promise<Middleware> => {
      const body = toProtoMiddlewarePatch(args.input);
      const res = (await patchMiddleware(tenantId, args.id, body)) as unknown as {
        data: ProtoMiddleware;
      };
      return fromProtoMiddleware(res.data, tenantId);
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: getListMiddlewaresQueryKey(tenantId) });
      void qc.invalidateQueries({
        queryKey: getGetMiddlewareQueryKey(tenantId, vars.id),
      });
    },
  });
}

export function useDeleteMiddlewareMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await orvalDeleteMiddleware(tenantId, id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListMiddlewaresQueryKey(tenantId) });
    },
  });
}
