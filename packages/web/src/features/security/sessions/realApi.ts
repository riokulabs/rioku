/**
 * Sessions real-API surface — re-exports of the Orval-generated hooks.
 *
 * See `roles/realApi.ts` for the wiring rationale.
 */

export {
  useListSessions,
  useRevokeSession,
  useRevokeOtherSessions,
  getListSessionsQueryKey,
} from '@/api/generated/sessions/sessions';
