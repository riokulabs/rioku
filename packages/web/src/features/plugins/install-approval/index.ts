/**
 * Install-approval feature — barrel exports.
 */
export { InstallApprovalModal } from './components/modal';
export { InstallProgressModal } from './components/install-progress-modal';
export {
  installPlugin,
  isAdminLevelPermission,
  adminLevelPermissions,
} from './api';
export type { ApprovalCandidate } from './types';
