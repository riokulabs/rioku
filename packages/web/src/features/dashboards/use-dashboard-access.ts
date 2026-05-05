/**
 * useDashboardAccess — react hook returning the effective access level for
 * the current user on a given dashboard.
 *
 * Wraps `resolveDashboardAccess` with current-user/tenant/membership lookups
 * from the mock store + the tenant-level `dashboard:write` permission.
 */
import { useMemo } from 'react';
import { useMockStore } from '@/api/mock-store';
import { usePermission } from '@/hooks/use-permission';
import type { Dashboard } from '@/api/resources';
import { resolveDashboardAccess, type DashboardAccessLevel } from './access';

export function useDashboardAccess(dashboard: Dashboard | undefined): DashboardAccessLevel {
  const currentUserId = useMockStore((s) => s.currentUserId);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  const memberships = useMockStore((s) => s.memberships);
  const hasTenantWrite = usePermission('dashboard:write');

  return useMemo(() => {
    if (!dashboard) return 'none';

    const roleIds = new Set<string>();
    for (const m of Object.values(memberships)) {
      if (m.user_id === currentUserId && m.tenant_id === currentTenantId && m.state === 'active') {
        for (const rid of m.role_ids) roleIds.add(rid);
      }
    }

    return resolveDashboardAccess({
      dashboard,
      userId: currentUserId,
      tenantId: currentTenantId,
      roleIds: Array.from(roleIds),
      hasTenantWrite,
    });
  }, [dashboard, currentUserId, currentTenantId, memberships, hasTenantWrite]);
}
