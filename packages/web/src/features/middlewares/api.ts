/**
 * Middlewares API surface. Mutators take a leading `tenantId` since the
 * daemon REST surface is tenant-scoped. `deleteMiddleware` translates a
 * 409 (routes still reference the middleware) into `MiddlewareInUseError`.
 */

import {
  createMiddleware as orvalCreateMiddleware,
  patchMiddleware as orvalPatchMiddleware,
  deleteMiddleware as orvalDeleteMiddleware,
} from '@/api/generated/middlewares/middlewares';
import type { Middleware as ProtoMiddleware } from '@/api/generated/schemas';
import type { Middleware } from '@/api/resources';
import { useMiddlewareListReal, useMiddlewareDetailReal } from './api.stage2';
import type { MiddlewareFilter, MiddlewareInput, MiddlewareUpdateInput } from './types';
import { MiddlewareInUseError } from './types';
import { fromProtoMiddleware, toProtoMiddlewareCreate, toProtoMiddlewarePatch } from './adapter';

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useMiddlewareList(tenantId: string, filter: MiddlewareFilter): Middleware[] {
  return useMiddlewareListReal(tenantId, filter).middlewares;
}

export function useMiddlewareDetail(tenantId: string, id: string): Middleware | undefined {
  return useMiddlewareDetailReal(tenantId, id);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createMiddleware(
  tenantId: string,
  input: MiddlewareInput,
): Promise<Middleware> {
  const body = toProtoMiddlewareCreate(input);
  const res = (await orvalCreateMiddleware(
    tenantId,
    body,
  )) as unknown as { data: ProtoMiddleware };
  return fromProtoMiddleware(res.data, tenantId);
}

export async function updateMiddleware(
  tenantId: string,
  id: string,
  input: MiddlewareUpdateInput,
): Promise<Middleware> {
  const body = toProtoMiddlewarePatch(input);
  const res = (await orvalPatchMiddleware(
    tenantId,
    id,
    body,
  )) as unknown as { data: ProtoMiddleware };
  return fromProtoMiddleware(res.data, tenantId);
}

export async function deleteMiddleware(tenantId: string, id: string): Promise<void> {
  try {
    await orvalDeleteMiddleware(tenantId, id);
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      (err as { status: number }).status === 409
    ) {
      const detail = err as { data?: { routeIds?: string[] } };
      throw new MiddlewareInUseError(detail.data?.routeIds ?? []);
    }
    throw err;
  }
}
