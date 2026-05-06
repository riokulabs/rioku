/**
 * Access-policies API — wired to the real daemon via Orval-generated hooks.
 *
 * Stage-2 plan-02: this file replaces the previous Zustand-mock-store
 * implementation. Public function names are preserved; the data path
 * goes through `customFetch` → daemon REST endpoints. Wire payloads
 * (camelCase) are adapted into the in-tree `AccessPolicy` shape
 * (snake_case) at this boundary.
 */
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListAccessPolicies,
  useGetAccessPolicy,
  getListAccessPoliciesQueryKey,
  getGetAccessPolicyQueryKey,
  createAccessPolicy as createAccessPolicyFn,
  patchAccessPolicy as patchAccessPolicyFn,
  deleteAccessPolicy as deleteAccessPolicyFn,
  testAccessPolicyCel as testAccessPolicyCelFn,
} from '@/api/generated/access-policies/access-policies';
import type {
  ListAccessPolicies200AccessPoliciesItem,
  CreateAccessPolicyBody,
  PatchAccessPolicyBody,
  TestAccessPolicyCelBody,
  TestAccessPolicyCel200,
} from '@/api/generated/schemas';
import { emitHostEvent } from '@/host/events';
import type { AccessPolicy } from './types';
import type { AccessPolicyPayload } from './types';

function queryErrorToError(err: unknown): Error | null {
  if (err === null || err === undefined) return null;
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error('Unknown error');
  }
}

function adaptFromWire(raw: ListAccessPolicies200AccessPoliciesItem): AccessPolicy {
  return {
    id: raw.id ?? '',
    tenant_id: raw.tenantId ?? '',
    name: raw.name ?? '',
    condition: raw.expression ?? '',
    action: raw.effect === 'deny' ? 'deny' : 'allow',
    priority: raw.priority ?? 100,
    enabled: raw.enabled ?? false,
    created_at: raw.createdAt ?? '',
  };
}

function adaptToWire(payload: AccessPolicyPayload): CreateAccessPolicyBody {
  return {
    name: payload.name,
    expression: payload.condition,
    effect: payload.action,
    priority: payload.priority,
    enabled: payload.enabled,
  };
}

function adaptPartialToWire(payload: Partial<AccessPolicyPayload>): PatchAccessPolicyBody {
  const out: PatchAccessPolicyBody = {};
  if (payload.name !== undefined) out.name = payload.name;
  if (payload.condition !== undefined) out.expression = payload.condition;
  if (payload.action !== undefined) out.effect = payload.action;
  if (payload.priority !== undefined) out.priority = payload.priority;
  if (payload.enabled !== undefined) out.enabled = payload.enabled;
  return out;
}

export function useAccessPolicyList(tenant: string): {
  data: AccessPolicy[];
  isLoading: boolean;
  error: Error | null;
} {
  const query = useListAccessPolicies(tenant);
  const data = useMemo<AccessPolicy[]>(() => {
    const items = query.data?.data.accessPolicies ?? [];
    return items.map(adaptFromWire);
  }, [query.data]);
  return { data, isLoading: query.isLoading, error: queryErrorToError(query.error) };
}

export function useAccessPolicy(
  tenant: string,
  id: string,
): { data: AccessPolicy | undefined; isLoading: boolean; error: Error | null } {
  const query = useGetAccessPolicy(tenant, id);
  const data = useMemo<AccessPolicy | undefined>(() => {
    const wire = query.data?.data as ListAccessPolicies200AccessPoliciesItem | undefined;
    if (!wire || typeof wire !== 'object') return undefined;
    return adaptFromWire(wire);
  }, [query.data]);
  return { data, isLoading: query.isLoading, error: queryErrorToError(query.error) };
}

export function useCreateAccessPolicyMutation(tenant: string) {
  const qc = useQueryClient();
  return async function createAccessPolicyMutation(
    payload: AccessPolicyPayload,
  ): Promise<void> {
    await createAccessPolicyFn(tenant, adaptToWire(payload));
    await qc.invalidateQueries({ queryKey: getListAccessPoliciesQueryKey(tenant) });
    emitHostEvent('policy:saved', { tenant_id: tenant, action: 'created' });
  };
}

export function useUpdateAccessPolicyMutation(tenant: string) {
  const qc = useQueryClient();
  return async function updateAccessPolicyMutation(
    id: string,
    payload: Partial<AccessPolicyPayload>,
  ): Promise<void> {
    await patchAccessPolicyFn(tenant, id, adaptPartialToWire(payload));
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListAccessPoliciesQueryKey(tenant) }),
      qc.invalidateQueries({ queryKey: getGetAccessPolicyQueryKey(tenant, id) }),
    ]);
    emitHostEvent('policy:saved', { policy_id: id, tenant_id: tenant, action: 'updated' });
  };
}

export function useDeleteAccessPolicyMutation(tenant: string) {
  const qc = useQueryClient();
  return async function deleteAccessPolicyMutation(id: string): Promise<void> {
    await deleteAccessPolicyFn(tenant, id);
    await qc.invalidateQueries({ queryKey: getListAccessPoliciesQueryKey(tenant) });
    emitHostEvent('policy:deleted', { policy_id: id, tenant_id: tenant });
  };
}

export async function testAccessPolicyCelMutation(
  tenant: string,
  body: TestAccessPolicyCelBody,
): Promise<TestAccessPolicyCel200> {
  const resp = await testAccessPolicyCelFn(tenant, body);
  return resp.data as TestAccessPolicyCel200;
}

export async function createAccessPolicyMutation(
  tenant: string,
  payload: AccessPolicyPayload,
): Promise<AccessPolicy> {
  const resp = await createAccessPolicyFn(tenant, adaptToWire(payload));
  emitHostEvent('policy:saved', { tenant_id: tenant, action: 'created' });
  const wire = resp.data as unknown as ListAccessPolicies200AccessPoliciesItem | undefined;
  if (wire && typeof wire === 'object') return adaptFromWire(wire);
  return {
    id: '',
    tenant_id: tenant,
    name: payload.name,
    condition: payload.condition,
    action: payload.action,
    priority: payload.priority,
    enabled: payload.enabled,
    created_at: new Date().toISOString(),
  };
}

export async function updateAccessPolicyMutation(
  tenant: string,
  id: string,
  payload: Partial<AccessPolicyPayload>,
): Promise<void> {
  await patchAccessPolicyFn(tenant, id, adaptPartialToWire(payload));
  emitHostEvent('policy:saved', { policy_id: id, tenant_id: tenant, action: 'updated' });
}

export async function deleteAccessPolicyMutation(tenant: string, id: string): Promise<void> {
  await deleteAccessPolicyFn(tenant, id);
  emitHostEvent('policy:deleted', { policy_id: id, tenant_id: tenant });
}
