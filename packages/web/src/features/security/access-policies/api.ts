/**
 * Access-policies API — backed by the Zustand mock store.
 *
 * All writes simulate latency via simulateLatency('mutation').
 * Read selectors are synchronous Zustand selectors.
 */
import { useMockStore } from '@/api/mock-store';
import { simulateLatency } from '@/api/mock-latency';
import { makeIdFactory } from '@/lib/id-generator';
import type { AccessPolicy } from './types';
import type { AccessPolicyPayload } from './types';

const nextId = makeIdFactory('acpol-new');

// ─── Selectors ─────────────────────────────────────────────────────────────────

/** Returns all access policies as an array (all tenants — caller filters if needed). */
export function useAccessPolicyList(): AccessPolicy[] {
  const raw = useMockStore((s) => s.accessPolicies);
  return Object.values(raw);
}

/** Returns a single access policy by ID, or undefined. */
export function useAccessPolicy(id: string): AccessPolicy | undefined {
  return useMockStore((s) => s.accessPolicies[id]);
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

/** Create a new access policy and insert it into the store. */
export async function createAccessPolicyMutation(
  tenantId: string,
  payload: AccessPolicyPayload,
): Promise<AccessPolicy> {
  await simulateLatency('mutation');
  const policy: AccessPolicy = {
    id: nextId(),
    tenant_id: tenantId,
    name: payload.name,
    condition: payload.condition,
    action: payload.action,
    priority: payload.priority,
    enabled: payload.enabled,
    created_at: new Date().toISOString(),
  };
  useMockStore.getState().addEntity('accessPolicies', policy);
  return policy;
}

/** Update an existing access policy. */
export async function updateAccessPolicyMutation(
  id: string,
  payload: Partial<AccessPolicyPayload>,
): Promise<void> {
  await simulateLatency('mutation');
  useMockStore.getState().updateEntity('accessPolicies', id, payload);
}

/** Delete an access policy from the store. */
export async function deleteAccessPolicyMutation(id: string): Promise<void> {
  await simulateLatency('mutation');
  useMockStore.getState().deleteEntity('accessPolicies', id);
}
