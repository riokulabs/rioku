/**
 * Users real-API surface — re-exports of the Orval-generated hooks.
 *
 * See `roles/realApi.ts` for the wiring rationale.
 */

export {
  useListUsers,
  useGetUser,
  useCreateUser,
  usePatchUser,
  useReplaceUser,
  useDeleteUser,
  useActivateUser,
  useSuspendUser,
  useLockUser,
  useUnlockUser,
  useResetUserPassword,
  useListUserSessions,
  getListUsersQueryKey,
  getGetUserQueryKey,
  getListUserSessionsQueryKey,
} from '@/api/generated/users/users';
