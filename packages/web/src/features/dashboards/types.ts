/**
 * Dashboards feature-local types.
 */
import type {
  Dashboard,
  DashboardPermissionLevel,
  DashboardRangeSpec,
  DashboardRoleGrant,
  DashboardUserGrant,
  DashboardVariable,
  Widget,
} from '@/api/resources/types';

export type {
  Dashboard,
  DashboardPermissionLevel,
  DashboardRangeSpec,
  DashboardRangeUnit,
  DashboardRoleGrant,
  DashboardUserGrant,
  DashboardVariable,
  DashboardVersion,
  Widget,
  ID,
} from '@/api/resources/types';

export interface DashboardFilter {
  search: string;
  /** Limit by mode. Empty = no filter. */
  modes: ('metabase' | 'grafana')[];
  /** Limit by scope. Empty = no filter. */
  scopes: ('personal' | 'tenant' | 'shared')[];
  /** When true, only return tenant default dashboards. */
  defaultOnly?: boolean;
}

export interface CreateDashboardInput {
  name: string;
  description?: string;
  mode?: 'metabase' | 'grafana';
  scope?: 'personal' | 'tenant' | 'shared';
  owner_user_id?: string | null;
  shared_role_ids?: string[];
  variables?: DashboardVariable[];
}

export interface UpdateDashboardInput {
  name?: string;
  description?: string;
  mode?: 'metabase' | 'grafana';
  scope?: 'personal' | 'tenant' | 'shared';
  owner_user_id?: string | null;
  shared_role_ids?: string[];
  variables?: DashboardVariable[];
  layout?: Record<string, { x: number; y: number; w: number; h: number }>;
  widget_ids?: string[];
  default_range?: DashboardRangeSpec;
  share_permission?: DashboardPermissionLevel;
  role_grants?: DashboardRoleGrant[];
  user_grants?: DashboardUserGrant[];
}

/** The JSON-exportable dashboard shape. */
export interface DashboardExport {
  version: string;
  exported_at: string;
  dashboard: Dashboard;
  widgets: Widget[];
}

export const DASHBOARD_EXPORT_VERSION = 'plan4-v1' as const;

export class DashboardImportError extends Error {
  readonly code = 'DASHBOARD_IMPORT_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'DashboardImportError';
  }
}
