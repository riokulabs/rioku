/**
 * Middlewares API — Stage 2 thin facade over the Orval-generated client and
 * the stage-2 hook layer in `api.stage2.ts`.
 *
 * Stage-1 published `useMiddlewareList`, `useMiddlewareDetail`,
 * `createMiddleware`, `updateMiddleware`, and `deleteMiddleware` against the
 * mock store. This module preserves the hook names but routes them through
 * the real daemon endpoints. Imperative mutators gain a leading `tenantId`
 * argument since the daemon REST surface is tenant-scoped.
 *
 * Delete still surfaces `MiddlewareInUseError` when the daemon returns a
 * 409 (routes still reference the middleware) so the existing UX path keeps
 * working.
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
import {
  fromProtoMiddleware,
  toProtoMiddlewareCreate,
  toProtoMiddlewarePatch,
} from './adapter';

// ─── Selectors ────────────────────────────────────────────────────────────────

export function useMiddlewareList(
  tenantId: string,
  filter: MiddlewareFilter,
): Middleware[] {
  return useMiddlewareListReal(tenantId, filter).middlewares;
}

export function useMiddlewareDetail(
  tenantId: string,
  id: string,
): Middleware | undefined {
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
    body as unknown as Parameters<typeof orvalCreateMiddleware>[1],
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
    body as unknown as Parameters<typeof orvalPatchMiddleware>[2],
  )) as unknown as { data: ProtoMiddleware };
  return fromProtoMiddleware(res.data, tenantId);
}

export async function deleteMiddleware(
  tenantId: string,
  id: string,
): Promise<void> {
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
