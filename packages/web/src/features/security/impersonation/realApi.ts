/**
 * Impersonation real-API surface — re-exports of the Orval-generated hooks.
 *
 * See `../roles/realApi.ts` for the wiring rationale.
 */

export {
  useListImpersonationSessions,
  useStartImpersonation,
  useEndImpersonation,
  useTouchImpersonation,
  getListImpersonationSessionsQueryKey,
} from '@/api/generated/impersonation/impersonation';
