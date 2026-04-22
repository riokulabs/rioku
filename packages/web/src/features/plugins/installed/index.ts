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
  installPluginWithProgress,
  getBuildLog,
} from './api';
export type {
  InstallProgressStage,
  InstallProgressEvent,
  InstallCompleteEvent,
  InstallFailedEvent,
  InstallProgressEmitter,
} from './api';
export type { InstalledPluginFilter, Plugin } from './types';
