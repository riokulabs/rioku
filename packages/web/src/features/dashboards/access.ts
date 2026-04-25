/**
 * Dashboard access resolution.
 *
 * Given a Dashboard + the current user (id, role ids, permissions), compute
 * the effective access level: 'none' | 'read' | 'write'.
 *
 * Precedence (highest wins):
 *   1. Tenant mismatch                              → none.
 *   2. Owner of the dashboard                       → write.
 *   3. Per-user grant in `user_grants`              → grant.level.
 *   4. Scope rule:
 *      - personal: only owner (handled above)      → none.
 *      - tenant:                                    → share_permission || 'read'.
 *      - shared: any role match                     → role_grant.level || share_permission || 'read'.
 *
 * Tenant-level `dashboard:write` permission is then required for writes — a
 * dashboard grant without the tenant-level perm collapses to read-only.
 */
import type {
  Dashboard,
  DashboardPermissionLevel,
} from '@/api/resources/types';

export type DashboardAccessLevel = 'none' | DashboardPermissionLevel;

export interface DashboardAccessInput {
  dashboard: Dashboard;
  /** Current user's id, or null for unauthenticated. */
  userId: string | null;
  /** Active tenant id. */
  tenantId: string | null;
  /** Active role ids the user holds in the active tenant. */
  roleIds: readonly string[];
  /** Whether the user holds tenant-level dashboard:write. */
  hasTenantWrite: boolean;
}

export function resolveDashboardAccess(input: DashboardAccessInput): DashboardAccessLevel {
  const { dashboard, userId, tenantId, roleIds, hasTenantWrite } = input;

  if (!tenantId || dashboard.tenant_id !== tenantId) return 'none';

  const isOwner = userId !== null && dashboard.owner_user_id === userId;
  if (isOwner) return clampWrite('write', hasTenantWrite);

  // Per-user explicit grant trumps scope.
  const userGrant = dashboard.user_grants?.find((g) => g.user_id === userId);
  if (userGrant) return clampWrite(userGrant.level, hasTenantWrite);

  if (dashboard.scope === 'personal') return 'none';

  const fallback: DashboardPermissionLevel = dashboard.share_permission ?? 'read';

  if (dashboard.scope === 'tenant') {
    return clampWrite(fallback, hasTenantWrite);
  }

  // scope === 'shared'
  const matchedRoleIds = dashboard.shared_role_ids.filter((rid) => roleIds.includes(rid));
  if (matchedRoleIds.length === 0) return 'none';

  // If any matching role has an explicit grant, take the highest (write > read).
  const explicitGrants = (dashboard.role_grants ?? []).filter((g) =>
    matchedRoleIds.includes(g.role_id),
  );
  if (explicitGrants.some((g) => g.level === 'write')) return clampWrite('write', hasTenantWrite);
  if (explicitGrants.some((g) => g.level === 'read')) return clampWrite('read', hasTenantWrite);

  return clampWrite(fallback, hasTenantWrite);
}

function clampWrite(
  level: DashboardPermissionLevel,
  hasTenantWrite: boolean,
): DashboardPermissionLevel {
  if (level === 'write' && !hasTenantWrite) return 'read';
  return level;
}

/** Convenience: can this user edit this dashboard given the access input? */
export function canEditDashboard(input: DashboardAccessInput): boolean {
  return resolveDashboardAccess(input) === 'write';
}

/** Convenience: can this user view this dashboard? */
export function canViewDashboard(input: DashboardAccessInput): boolean {
  return resolveDashboardAccess(input) !== 'none';
}
