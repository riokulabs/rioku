/**
 * API keys real-API surface — re-exports of the Orval-generated hooks.
 *
 * See `roles/realApi.ts` for the wiring rationale.
 */

export {
  useListAPIKeys,
  useGetAPIKey,
  useCreateAPIKey,
  usePatchAPIKey,
  useReplaceAPIKey,
  useDeleteAPIKey,
  useRevokeAPIKey,
  useRotateAPIKey,
  useGetAPIKeyUsage,
  getListAPIKeysQueryKey,
  getGetAPIKeyQueryKey,
} from '@/api/generated/api-keys/api-keys';
