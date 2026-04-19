/**
 * Roles feature — barrel exports.
 */
export { RoleList } from './components/list';
export { RoleDetail } from './components/detail';
export { RoleCreate } from './components/create';
export { RoleDeleteConfirm } from './components/delete-confirm';
export {
  useRoleList,
  useRole,
  useRolesMap,
  useRoleUserCounts,
  createRoleMutation,
  updateRoleMutation,
  deleteRoleMutation,
} from './api';
export type { RolePayload, GrantRow } from './types';
export type { RoleCreateFormValues } from './schemas';
