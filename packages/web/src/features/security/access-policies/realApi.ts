/**
 * Access policies real-API surface — re-exports of the Orval-generated hooks.
 *
 * See `../roles/realApi.ts` for the wiring rationale.
 */

export {
  useListAccessPolicies,
  useGetAccessPolicy,
  useCreateAccessPolicy,
  usePatchAccessPolicy,
  useReplaceAccessPolicy,
  useDeleteAccessPolicy,
  getListAccessPoliciesQueryKey,
  getGetAccessPolicyQueryKey,
} from '@/api/generated/access-policies/access-policies';
