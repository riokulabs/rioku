/**
 * Access-policies adapter — bridges the daemon's wire shape (`AccessPolicy`
 * from generated schemas) to the admin panel's `AccessPolicy` resource type.
 *
 * Note: the daemon's persisted access-policy model uses a structured
 * `conditions` array, while the admin panel keeps a single `condition` CEL
 * expression. The OpenAPI fragment exposes an `expression` field on the
 * wire; when the daemon side migrates to flat-CEL the adapter is a no-op.
 * Until then, missing `expression` round-trips as an empty string.
 */

import type { AccessPolicy as ProtoAccessPolicy } from '@/api/generated/schemas';
import type { AccessPolicy } from '@/api/resources';
import type { AccessPolicyPayload } from './types';

function asAction(s: string | undefined): AccessPolicy['action'] {
  return s === 'deny' ? 'deny' : 'allow';
}

export function fromProtoAccessPolicy(
  proto: ProtoAccessPolicy,
  fallbackTenantId: string,
): AccessPolicy {
  return {
    id: proto.id ?? '',
    tenant_id: proto.tenantId ?? fallbackTenantId,
    name: proto.name ?? '',
    condition: proto.expression ?? '',
    action: asAction(proto.effect),
    priority: proto.priority ?? 0,
    enabled: proto.enabled ?? true,
    created_at: proto.createdAt ?? new Date().toISOString(),
  };
}

export function toProtoAccessPolicyCreate(payload: AccessPolicyPayload): {
  name: string;
  expression: string;
  effect: 'allow' | 'deny';
  priority?: number;
  enabled?: boolean;
} {
  return {
    name: payload.name,
    expression: payload.condition,
    effect: payload.action,
    priority: payload.priority,
    enabled: payload.enabled,
  };
}

export function toProtoAccessPolicyPatch(
  payload: Partial<AccessPolicyPayload>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (payload.name !== undefined) body.name = payload.name;
  if (payload.condition !== undefined) body.expression = payload.condition;
  if (payload.action !== undefined) body.effect = payload.action;
  if (payload.priority !== undefined) body.priority = payload.priority;
  if (payload.enabled !== undefined) body.enabled = payload.enabled;
  return body;
}
