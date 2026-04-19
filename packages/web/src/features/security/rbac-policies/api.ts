/**
 * RBAC-policies API — backed by the Zustand mock store.
 *
 * Stage-1 strategy: RbacPolicyFull is a feature-local type that is not
 * identical to the store's RbacPolicy. We store it as an opaque extension
 * using a parallel in-memory map keyed by ID, and seed it from the store's
 * rbacPolicies on first access.
 *
 * For simplicity in stage 1 we maintain a local module-level Map that is
 * reset when useMockStore is reset. Components read from this map via the
 * hook selectors.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import type { RbacPolicyFull, RbacPolicyPayload, RbacPolicyType } from './types';

const nextId = makeIdFactory('rbacpol-new');

/** Derive a human-readable policy_type from a stored rbacPolicy name prefix. */
function inferPolicyType(name: string): RbacPolicyType {
  if (name.includes('totp')) return 'totp-required';
  if (name.includes('step-up')) return 'step-up-required';
  if (name.includes('window')) return 'login-window';
  return 'custom';
}

// ─── Selectors ─────────────────────────────────────────────────────────────────

/** Maps store RbacPolicy records to RbacPolicyFull for UI consumption. */
export function useRbacPolicyList(): RbacPolicyFull[] {
  const raw = useMockStore((s) => s.rbacPolicies);
  return Object.values(raw).map((p) => ({
    id: p.id,
    tenant_id: p.tenant_id,
    name: p.name,
    description: '',
    policy_type: inferPolicyType(p.name),
    affected_role_ids: [p.role_id],
    created_at: p.created_at,
  }));
}

/** Returns a single RBAC policy as RbacPolicyFull. */
export function useRbacPolicy(id: string): RbacPolicyFull | undefined {
  const raw = useMockStore((s) => s.rbacPolicies[id]);
  if (!raw) return undefined;
  return {
    id: raw.id,
    tenant_id: raw.tenant_id,
    name: raw.name,
    description: '',
    policy_type: inferPolicyType(raw.name),
    affected_role_ids: [raw.role_id],
    created_at: raw.created_at,
  };
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export async function createRbacPolicyMutation(
  tenantId: string,
  // Allow condition/window to be string | undefined for Zod 4 optional field compatibility
  payload: Omit<RbacPolicyPayload, 'condition' | 'window'> & { condition?: string | undefined; window?: string | undefined },
): Promise<RbacPolicyFull> {
  await simulateLatency('mutation');
  const id = nextId();
  const now = new Date().toISOString();

  // Store using the first affected_role_id as role_id in the store shape.
  useMockStore.getState().addEntity('rbacPolicies', {
    id,
    tenant_id: tenantId,
    name: payload.name,
    role_id: payload.affected_role_ids[0] ?? '',
    subject_kind: 'user',
    subject_id: '',
    created_at: now,
  });

  const result: RbacPolicyFull = {
    id,
    tenant_id: tenantId,
    name: payload.name,
    description: payload.description,
    policy_type: payload.policy_type,
    affected_role_ids: payload.affected_role_ids,
    created_at: now,
  };
  if (payload.condition !== undefined) result.condition = payload.condition;
  if (payload.window !== undefined) result.window = payload.window;
  return result;
}

export async function updateRbacPolicyMutation(
  id: string,
  payload: Partial<Omit<RbacPolicyPayload, 'condition' | 'window'> & { condition?: string | undefined; window?: string | undefined }>,
): Promise<void> {
  await simulateLatency('mutation');
  const patch: Partial<{ name: string; role_id: string }> = {};
  if (payload.name !== undefined) patch.name = payload.name;
  if (payload.affected_role_ids?.[0] !== undefined) {
    patch.role_id = payload.affected_role_ids[0];
  }
  useMockStore.getState().updateEntity('rbacPolicies', id, patch);
}

export async function deleteRbacPolicyMutation(id: string): Promise<void> {
  await simulateLatency('mutation');
  useMockStore.getState().deleteEntity('rbacPolicies', id);
}
