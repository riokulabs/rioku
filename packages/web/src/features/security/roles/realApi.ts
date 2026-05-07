/**
 * Roles real-API surface — re-exports of the Orval-generated hooks.
 *
 * This module is the entry point for stage-2 real-daemon wiring. The
 * mock-store-backed `api.ts` next to this file remains the source of
 * truth for the rest of the SPA until the `VITE_USE_MOCKS=false` flip
 * is performed (tracked in contrib-docs/admin-stage2-entry.md).
 *
 * Consumers that want the real-API path today (e.g. MSW-based tests,
 * the permissions-catalog integration page) import from here directly.
 */

export {
  useListRoles,
  useGetRole,
  useCreateRole,
  usePatchRole,
  useReplaceRole,
  useDeleteRole,
  useListUserRoles,
  useAssignUserRole,
  useRevokeUserRole,
  getListRolesQueryKey,
  getGetRoleQueryKey,
  getListUserRolesQueryKey,
} from '@/api/generated/roles/roles';
