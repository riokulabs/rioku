/**
 * Installed plugins feature — barrel exports.
 */
export { InstalledPluginList } from './components/list';
export { InstalledPluginDetail } from './components/detail';
export { UninstallPluginModal } from './components/uninstall-modal';
export {
  useInstalledPluginList,
  useInstalledPlugin,
  usePluginAuditTail,
  useInstalledPluginMutations,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
} from './api';
export type { InstalledPluginFilter, Plugin } from './types';
export type { UninstallConfirmFormValues } from './schemas';
