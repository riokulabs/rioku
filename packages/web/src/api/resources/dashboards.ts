// Types for the dashboards resource surface.

import type { ID } from './common';

export type DashboardRangeUnit = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export type DashboardRangeSpec =
  | { kind: 'preset'; id: '1h' | '6h' | '24h' | '7d' | '30d' | '90d' }
  | { kind: 'relative'; amount: number; unit: DashboardRangeUnit }
  | { kind: 'absolute'; from: string; to: string };

/**
 * Per-dashboard permission grant: a role or user gets either read-only access
 * or full read/update (edit). Owners always have implicit write access.
 */
export type DashboardPermissionLevel = 'read' | 'write';

export interface DashboardRoleGrant {
  role_id: ID;
  level: DashboardPermissionLevel;
}

export interface DashboardUserGrant {
  user_id: ID;
  level: DashboardPermissionLevel;
}

export interface DashboardVariable {
  name: string;
  kind: 'text' | 'enum' | 'interval';
  default: string;
  /** Populated when kind === 'enum'. */
  options?: string[];
}

export interface Dashboard {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  default: boolean;
  widget_ids: ID[];
  description?: string;
  /** null = tenant-shared. */
  owner_user_id: ID | null;
  mode: 'metabase' | 'grafana';
  /**
   * Dashboard visibility:
   *   - `personal`: only the owner can view/edit.
   *   - `shared`:   only listed roles + users grants apply.
   *   - `tenant`:   anyone in the tenant with `dashboard:read` can view (i.e. "public to tenant").
   */
  scope: 'personal' | 'tenant' | 'shared';
  /**
   * Default permission level applied to anyone who has access via `scope`
   * (excluding the owner, who always has write). For `tenant` scope this
   * controls whether the dashboard is read-only or editable by all tenant
   * members. For `shared` scope it's the fallback level for roles that
   * appear in `shared_role_ids` without an explicit `role_grants` entry.
   * For `personal` scope this field is ignored. Defaults to 'read' when
   * omitted on existing seeds.
   */
  share_permission?: DashboardPermissionLevel;
  /** Roles allowed to view when scope === 'shared'. */
  shared_role_ids: ID[];
  /**
   * Per-role permission overrides. When present, these override
   * `share_permission` for the specified role. Used to e.g. give one role
   * write access while keeping the rest read-only.
   */
  role_grants?: DashboardRoleGrant[];
  /**
   * Per-user permission grants — independent of scope. A user listed here
   * gets access at the specified level even if scope is 'personal' or
   * their roles aren't in `shared_role_ids`.
   */
  user_grants?: DashboardUserGrant[];
  /** Grid layout (w,h,x,y per widget) keyed by widget id. Canonical layout source. */
  layout: Record<ID, { x: number; y: number; w: number; h: number }>;
  /** Grafana-mode variables (only relevant when mode === 'grafana'). */
  variables: DashboardVariable[];
  /** Default time-range applied when the dashboard opens. Optional — falls back to 24h. */
  default_range?: DashboardRangeSpec;
  readonly created_at: string;
  readonly updated_at: string;
}
