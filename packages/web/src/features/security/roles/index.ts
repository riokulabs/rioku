/**
 * Roles feature — barrel exports.
 */
export { RoleList } from './components/list';
export { RoleDetail } from './components/detail';
export { RoleCreate } from './components/create';
export { RoleDeleteConfirm } from './components/delete-confirm';
export { RoleDrawer } from './components/drawer';
export { RoleFullPage } from './components/full-page';
export {
  useRoleList,
  useRole,
  useRolesMap,
  useRoleUserCounts,
  useRoleMutations,
  createRoleMutation,
  updateRoleMutation,
  deleteRoleMutation,
  adaptRole,
} from './api';
export type { RolePayload, GrantRow } from './types';
export type { RoleCreateFormValues } from './schemas';
