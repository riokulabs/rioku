/**
 * Middlewares adapter — bridges the daemon's wire shape (`Middleware` from
 * generated schemas) to the admin panel's `Middleware` resource type and
 * back. The wire shape uses camelCase and `config` as a free-form object;
 * the admin shape uses snake_case and a discriminated `kind` union.
 */

import type { Middleware as ProtoMiddleware } from '@/api/generated/schemas';
import type { Middleware } from '@/api/resources';
import type { MiddlewareInput, MiddlewareUpdateInput } from './types';

const KIND_VALUES = [
  'rate-limit',
  'auth',
  'transform',
  'cors',
  'cache',
  'logging',
  'custom',
] as const;

function normalizeKind(kind: string | undefined): Middleware['kind'] {
  return KIND_VALUES.includes(kind as Middleware['kind'])
    ? (kind as Middleware['kind'])
    : 'custom';
}

/** Wire → admin resource. */
export function fromProtoMiddleware(
  proto: ProtoMiddleware,
  fallbackTenantId: string,
): Middleware {
  return {
    id: proto.id ?? '',
    tenant_id: proto.tenantId ?? fallbackTenantId,
    name: proto.name ?? '',
    kind: normalizeKind(proto.kind),
    config: (proto.config as Record<string, unknown> | undefined) ?? {},
    enabled: proto.enabled ?? true,
    order_hint: proto.orderHint ?? 100,
    created_at: proto.createdAt ?? new Date().toISOString(),
  };
}

/** Admin create → wire body. */
export function toProtoMiddlewareCreate(input: MiddlewareInput): {
  name: string;
  kind: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  orderHint?: number;
} {
  return {
    name: input.name,
    kind: input.kind,
    config: input.config,
    enabled: input.enabled ?? true,
    orderHint: input.order_hint ?? 100,
  };
}

/** Admin patch → wire body. */
export function toProtoMiddlewarePatch(input: MiddlewareUpdateInput): {
  name?: string;
  kind?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  orderHint?: number;
} {
  const body: ReturnType<typeof toProtoMiddlewarePatch> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.kind !== undefined) body.kind = input.kind;
  if (input.config !== undefined) body.config = input.config;
  if (input.enabled !== undefined) body.enabled = input.enabled;
  if (input.order_hint !== undefined) body.orderHint = input.order_hint;
  return body;
}
