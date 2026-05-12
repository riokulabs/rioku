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
  useEnablePluginMutation,
  useDisablePluginMutation,
  useUninstallPluginMutation,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
  installPluginWithProgress,
  getBuildLog,
  pluginQueryKeys,
} from './api';
export type {
  InstallProgressStage,
  InstallProgressEvent,
  InstallCompleteEvent,
  InstallFailedEvent,
  InstallProgressEmitter,
} from './api';
export type { InstalledPluginFilter, Plugin } from './types';
