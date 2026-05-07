/**
 * RBAC-policies API — backed by the Orval-generated daemon client (stage 2).
 *
 * Replaces the stage-1 mock-store-backed selectors. Every public function in
 * this module talks to the real daemon under `/api/v1/t/{tenant}/rbac-policies`.
 *
 * The hook surface (`useRbacPolicyList`, `useRbacPolicy`, `useBoundSubjects`)
 * wraps React Query; the imperative mutations (`createRbacPolicyMutation`,
 * `updateRbacPolicyMutation`, `deleteRbacPolicyMutation`) call the generated
 * async fetchers directly and invalidate the query cache via the singleton
 * query client. Public function names match the pre-rewrite contract so
 * existing routes/components keep compiling.
 */
import {
  useListRbacPolicies,
  useGetRbacPolicy,
  createRbacPolicy,
  patchRbacPolicy,
  replaceRbacPolicy,
  deleteRbacPolicy,
  getListRbacPoliciesQueryKey,
  getGetRbacPolicyQueryKey,
} from '@/api/generated/rbac-policies/rbac-policies';
import type { ListRbacPolicies200RbacPoliciesItem } from '@/api/generated/schemas';
import { queryClient } from '@/api/query-client';
import type { RbacPolicyFull, RbacPolicyPayload, RbacSubjectType } from './types';

// ─── Mappers ───────────────────────────────────────────────────────────────────

const SUBJECT_TYPES: readonly RbacSubjectType[] = ['user', 'group', 'service-account'];

function asSubjectType(s: string | undefined): RbacSubjectType {
  return s !== undefined && (SUBJECT_TYPES as readonly string[]).includes(s)
    ? (s as RbacSubjectType)
    : 'user';
}

function fromWire(p: ListRbacPolicies200RbacPoliciesItem): RbacPolicyFull {
  return {
    id: p.id ?? '',
    tenant_id: p.tenantId ?? '',
    name: p.name ?? '',
    description: p.description ?? '',
    enabled: p.enabled ?? true,
    subject_type: asSubjectType(p.subjectType),
    subject_id: p.subjectId ?? '',
    role_id: p.roleId ?? '',
    created_at: p.createdAt ?? '',
  };
}

function toWireCreate(payload: RbacPolicyPayload): {
  name: string;
  description: string;
  enabled: boolean;
  subjectType: RbacSubjectType;
  subjectId: string;
  roleId: string;
} {
  return {
    name: payload.name,
    description: payload.description,
    enabled: payload.enabled,
    subjectType: payload.subject_type,
    subjectId: payload.subject_id,
    roleId: payload.role_id,
  };
}

// ─── Selectors ─────────────────────────────────────────────────────────────────

/**
 * Returns the list of RBAC policies for the current tenant. Loading state
 * collapses to an empty array — callers needing a finer-grained status
 * should call `useListRbacPolicies` from `realApi.ts` directly.
 */
export function useRbacPolicyList(tenant?: string): RbacPolicyFull[] {
  const tenantSlug = tenant ?? '';
  const result = useListRbacPolicies(tenantSlug, {
    query: { enabled: tenantSlug.length > 0 },
  });
  const items = result.data?.data.rbacPolicies ?? [];
  return items.map(fromWire);
}

/** Returns a single RBAC policy as `RbacPolicyFull`, or `undefined` while loading. */
export function useRbacPolicy(tenant: string, id: string): RbacPolicyFull | undefined {
  const result = useGetRbacPolicy(tenant, id, {
    query: { enabled: tenant.length > 0 && id.length > 0 },
  });
  const wire = result.data?.data as ListRbacPolicies200RbacPoliciesItem | undefined;
  if (!wire) return undefined;
  return fromWire(wire);
}

/**
 * Returns all RBAC policies that share the same role binding as `roleId`.
 * Used by the "Bound subjects" tab on the policy full-page view.
 */
export function useBoundSubjects(tenant: string, roleId: string): RbacPolicyFull[] {
  const all = useRbacPolicyList(tenant);
  return all.filter((p) => p.role_id === roleId);
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

async function invalidateLists(tenant: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: getListRbacPoliciesQueryKey(tenant) });
}

async function invalidateOne(tenant: string, id: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: getGetRbacPolicyQueryKey(tenant, id) });
}

export async function createRbacPolicyMutation(
  tenant: string,
  payload: RbacPolicyPayload,
): Promise<RbacPolicyFull> {
  const body = toWireCreate(payload);
  const res = await createRbacPolicy(tenant, body);
  await invalidateLists(tenant);
  const wire = res.data as unknown as ListRbacPolicies200RbacPoliciesItem | undefined;
  if (wire && typeof wire === 'object' && wire.id !== undefined) {
    return fromWire(wire);
  }
  return {
    id: '',
    tenant_id: tenant,
    name: payload.name,
    description: payload.description,
    enabled: payload.enabled,
    subject_type: payload.subject_type,
    subject_id: payload.subject_id,
    role_id: payload.role_id,
    created_at: new Date().toISOString(),
  };
}

export async function updateRbacPolicyMutation(
  tenant: string,
  id: string,
  payload: Partial<RbacPolicyPayload>,
): Promise<void> {
  // The OpenAPI doc emits PATCH/PUT without a body schema, so the generated
  // fetcher doesn't accept one. Pass the merge-patch body via RequestInit.
  const body: Record<string, unknown> = {};
  if (payload.name !== undefined) body.name = payload.name;
  if (payload.description !== undefined) body.description = payload.description;
  if (payload.enabled !== undefined) body.enabled = payload.enabled;
  if (payload.subject_type !== undefined) body.subjectType = payload.subject_type;
  if (payload.subject_id !== undefined) body.subjectId = payload.subject_id;
  if (payload.role_id !== undefined) body.roleId = payload.role_id;

  await patchRbacPolicy(tenant, id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await invalidateLists(tenant);
  await invalidateOne(tenant, id);
}

/** Replace (PUT) a policy in full. */
export async function replaceRbacPolicyMutation(
  tenant: string,
  id: string,
  payload: RbacPolicyPayload,
): Promise<void> {
  await replaceRbacPolicy(tenant, id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toWireCreate(payload)),
  });
  await invalidateLists(tenant);
  await invalidateOne(tenant, id);
}

export async function deleteRbacPolicyMutation(tenant: string, id: string): Promise<void> {
  await deleteRbacPolicy(tenant, id);
  await invalidateLists(tenant);
  await invalidateOne(tenant, id);
}
