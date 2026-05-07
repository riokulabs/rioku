/**
 * Access Policies API — Stage 2: backed by Orval-generated TanStack Query hooks.
 *
 * Activated when `VITE_USE_MOCKS=false`. Wires CRUD + the `useTestCEL` hook
 * (POSTs to `/access-policies/test-cel`) for the policy editor's "Test
 * condition" button.
 *
 * Schema-mismatch note: see decisions-needed.md § Item 004. The daemon
 * persists policies as a structured `conditions` array but the OpenAPI
 * fragment + admin panel use a single CEL expression. The adapter bridges
 * via the `expression` field; full daemon migration is tracked separately.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAccessPolicies,
  getAccessPolicy as orvalGetAccessPolicy,
  createAccessPolicy as orvalCreateAccessPolicy,
  patchAccessPolicy,
  deleteAccessPolicy as orvalDeleteAccessPolicy,
  testAccessPolicyCel,
  getListAccessPoliciesQueryKey,
  getGetAccessPolicyQueryKey,
} from '@/api/generated/access-policies/access-policies';
import type {
  AccessPolicy as ProtoAccessPolicy,
  CreateAccessPolicyBody,
  ListAccessPolicies200,
  TestCELBody,
  TestCELResult,
  UpdateAccessPolicyBody,
} from '@/api/generated/schemas';
import type { AccessPolicy } from '@/api/resources';
import type { AccessPolicyPayload } from './types';
import {
  fromProtoAccessPolicy,
  toProtoAccessPolicyCreate,
  toProtoAccessPolicyPatch,
} from './adapter';

// ─── Query hooks ──────────────────────────────────────────────────────────────

export function useAccessPolicyListReal(tenantId: string): {
  policies: AccessPolicy[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: getListAccessPoliciesQueryKey(tenantId),
    queryFn: ({ signal }) => listAccessPolicies(tenantId, { signal }),
    enabled: Boolean(tenantId),
  });
  const body = (data as unknown as { data: ListAccessPolicies200 } | undefined)?.data;
  const policies: AccessPolicy[] =
    body?.accessPolicies?.map((p) => fromProtoAccessPolicy(p, tenantId)) ?? [];
  return { policies, isLoading, isError, error };
}

export function useAccessPolicyReal(
  tenantId: string,
  id: string,
): AccessPolicy | undefined {
  const { data } = useQuery({
    queryKey: getGetAccessPolicyQueryKey(tenantId, id),
    queryFn: ({ signal }) => orvalGetAccessPolicy(tenantId, id, { signal }),
    enabled: Boolean(tenantId) && Boolean(id),
  });
  if (!data) return undefined;
  const proto = (data as unknown as { data: ProtoAccessPolicy }).data;
  return fromProtoAccessPolicy(proto, tenantId);
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

export function useCreateAccessPolicyMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AccessPolicyPayload): Promise<AccessPolicy> => {
      const body = toProtoAccessPolicyCreate(payload);
      const res = (await orvalCreateAccessPolicy(
        tenantId,
        body as CreateAccessPolicyBody,
      )) as unknown as { data: ProtoAccessPolicy };
      return fromProtoAccessPolicy(res.data, tenantId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListAccessPoliciesQueryKey(tenantId) });
    },
  });
}

export function useUpdateAccessPolicyMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      payload: Partial<AccessPolicyPayload>;
    }): Promise<void> => {
      const body = toProtoAccessPolicyPatch(args.payload);
      await patchAccessPolicy(tenantId, args.id, body as UpdateAccessPolicyBody);
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: getListAccessPoliciesQueryKey(tenantId) });
      void qc.invalidateQueries({
        queryKey: getGetAccessPolicyQueryKey(tenantId, vars.id),
      });
    },
  });
}

export function useDeleteAccessPolicyMutation(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await orvalDeleteAccessPolicy(tenantId, id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: getListAccessPoliciesQueryKey(tenantId) });
    },
  });
}

// ─── CEL test hook ────────────────────────────────────────────────────────────

/**
 * Test a CEL expression against a sample event. Returns `{ matched, error?,
 * durationMs }`. Used by the policy editor's "Test condition" button.
 */
export function useTestCEL(tenantId: string) {
  return useMutation({
    mutationFn: async (args: {
      expr: string;
      sample?: Record<string, unknown>;
    }): Promise<TestCELResult> => {
      const body: TestCELBody = {
        expr: args.expr,
        ...(args.sample !== undefined ? { sample: args.sample } : {}),
      };
      const res = (await testAccessPolicyCel(tenantId, body)) as unknown as { data: TestCELResult };
      return res.data;
    },
  });
}

// ─── Compatibility re-exports ─────────────────────────────────────────────────
export {
  useAccessPolicyList,
  useAccessPolicy,
  createAccessPolicyMutation,
  updateAccessPolicyMutation,
  deleteAccessPolicyMutation,
} from './api';
