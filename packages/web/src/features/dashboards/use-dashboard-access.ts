/**
 * useDashboardAccess — react hook returning the effective access level for
 * the current user on a given dashboard.
 *
 * Wraps `resolveDashboardAccess` with current-user/tenant/role lookups
 * from the real auth and tenant hooks plus the tenant-level
 * `dashboard:write` permission.
 */
import { useMemo } from 'react';
import { useCurrentUser } from '@/features/auth/use-current-user';
import { useActiveTenantSlug } from '@/hooks/use-tenant';
import { usePermission } from '@/hooks/use-permission';
import type { Dashboard } from '@/api/resources';
import { resolveDashboardAccess, type DashboardAccessLevel } from './access';

export function useDashboardAccess(dashboard: Dashboard | undefined): DashboardAccessLevel {
  const currentUserQuery = useCurrentUser();
  const currentUserId = currentUserQuery.data?.id ?? null;
  const currentTenantId = useActiveTenantSlug();
  const rolesData = currentUserQuery.data?.roles;
  const hasTenantWrite = usePermission('dashboard:write');

  return useMemo(() => {
    if (!dashboard) return 'none';

    return resolveDashboardAccess({
      dashboard,
      userId: currentUserId,
      tenantId: currentTenantId,
      roleIds: rolesData ?? [],
      hasTenantWrite,
    });
  }, [dashboard, currentUserId, currentTenantId, rolesData, hasTenantWrite]);
}
