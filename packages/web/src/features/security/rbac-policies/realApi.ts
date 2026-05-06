/**
 * RBAC policies real-API surface — re-exports of the Orval-generated hooks.
 *
 * See `../roles/realApi.ts` for the wiring rationale.
 */

export {
  useListRbacPolicies,
  useGetRbacPolicy,
  useCreateRbacPolicy,
  usePatchRbacPolicy,
  useReplaceRbacPolicy,
  useDeleteRbacPolicy,
  useTestRbacPolicy,
  getListRbacPoliciesQueryKey,
  getGetRbacPolicyQueryKey,
} from '@/api/generated/rbac-policies/rbac-policies';
