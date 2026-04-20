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
export type {
  CreateDashboardFormValues,
  UpdateDashboardFormValues,
} from './schemas';

export {
  DashboardImportError,
  DASHBOARD_EXPORT_VERSION,
} from './types';
export type {
  DashboardFilter,
  CreateDashboardInput,
  UpdateDashboardInput,
  DashboardExport,
} from './types';

export { DashboardList } from './components/list';
export { DashboardFilterBar } from './components/filter-bar';
