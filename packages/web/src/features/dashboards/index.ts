/**
 * Dashboards feature — barrel exports.
 */
export {
  useDashboardList,
  useDashboardDetail,
  useDashboardWidgets,
  useDashboardVersions,
  useUserHomeDashboard,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  setDefaultDashboard,
  setAsMyHome,
  snapshotDashboard,
  restoreDashboardVersion,
  exportDashboardJson,
  importDashboardJson,
} from './api';

export {
  dashboardVariableSchema,
  createDashboardSchema,
  updateDashboardSchema,
  dashboardExportSchema,
} from './schemas';
export type { CreateDashboardFormValues, UpdateDashboardFormValues } from './schemas';

export { DashboardImportError, DASHBOARD_EXPORT_VERSION } from './types';
export type {
  DashboardFilter,
  CreateDashboardInput,
  UpdateDashboardInput,
  DashboardExport,
} from './types';

export { DashboardList } from './components/list';
export { DashboardFilterBar } from './components/filter-bar';
export { DashboardsSidebar } from './components/dashboards-sidebar';
export { DashboardViewer } from './components/viewer';
export { ShareDashboardModal } from './components/share-dashboard-modal';
export {
  resolveDashboardAccess,
  canEditDashboard,
  canViewDashboard,
} from './access';
export type { DashboardAccessLevel, DashboardAccessInput } from './access';
export { useDashboardAccess } from './use-dashboard-access';
export { VariablesPanel } from './components/variables-panel';
export type { VariablesPanelProps } from './components/variables-panel';
export { VersionHistoryDrawer } from './components/version-history-drawer';
export type { VersionHistoryDrawerProps } from './components/version-history-drawer';
export { ImportDashboardModal } from './components/import-dashboard-modal';
export type { ImportDashboardModalProps } from './components/import-dashboard-modal';
export { downloadDashboardExport } from './export-download';
