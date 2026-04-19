/**
 * Install-approval feature — barrel exports.
 */
export { InstallApprovalModal } from './components/modal';
export {
  installPlugin,
  isAdminLevelPermission,
  adminLevelPermissions,
} from './api';
export type { ApprovalCandidate } from './types';
