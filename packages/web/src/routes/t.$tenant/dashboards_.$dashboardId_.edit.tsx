/**
 * Dashboard builder route — /t/$tenant/dashboards/$dashboardId/edit
 *
 * Full-page interactive builder (Plan 4 Phase 4c). Guarded by `dashboard:write`
 * and the same scope rules as the viewer: personal dashboards must match the
 * owner; shared dashboards must intersect the user's role ids.
 */
import { useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { DashboardBuilderShell } from '@/features/dashboard-builder';
import { VersionHistoryDrawer, useDashboardDetail } from '@/features/dashboards';
import { resolveDashboardAccess } from '@/features/dashboards/access';
import { resolveRolePermissions } from '@/host/role-resolver';

function DashboardBuilderPage() {
  const { tenant, dashboardId } = Route.useParams();
  const navigate = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false);

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantSlug = tenantRecord?.slug ?? tenant;
  const dashboard = useDashboardDetail(dashboardId);

  function goBack(outcome: 'saved' | 'cancelled') {
    if (outcome === 'saved') {
      void navigate({
        to: '/t/$tenant/dashboards/$dashboardId',
        params: { tenant: tenantSlug, dashboardId },
      } as unknown as Parameters<typeof navigate>[0]);
      return;
    }
    void navigate({
      to: '/t/$tenant/dashboards/$dashboardId',
      params: { tenant: tenantSlug, dashboardId },
    } as unknown as Parameters<typeof navigate>[0]);
  }

  function handleVersionHistory(_id: string) {
    setHistoryOpen(true);
  }

  return (
    <>
      <DashboardBuilderShell
        dashboardId={dashboardId}
        onDone={goBack}
        onVersionHistory={handleVersionHistory}
      />
      {dashboard && (
        <VersionHistoryDrawer
          opened={historyOpen}
          dashboard={dashboard}
          onClose={() => {
            setHistoryOpen(false);
          }}
          onRestored={() => {
            setHistoryOpen(false);
            // After restore, return to viewer.
            void navigate({
              to: '/t/$tenant/dashboards/$dashboardId',
              params: { tenant: tenantSlug, dashboardId },
            } as unknown as Parameters<typeof navigate>[0]);
          }}
        />
      )}
    </>
  );
}

export const Route = createFileRoute('/t/$tenant/dashboards_/$dashboardId_/edit')({
  beforeLoad: (ctx) => {
    // 1. Baseline permission + auth check (tenant-level write).
    requirePermissions({ required: ['dashboard:write'] })();

    // 2. Per-dashboard access — must resolve to 'write'. This honours
    //    per-user grants, per-role grants, and the dashboard's
    //    `share_permission` fallback.
    const { params } = ctx;
    const { dashboardId } = params as { dashboardId: string };
    const { dashboards, currentUserId, currentTenantId, memberships, roles } =
      useMockStore.getState();
    const dashboard = dashboards[dashboardId];
    if (!dashboard) return true;

    const userRoleIds = new Set<string>();
    for (const m of Object.values(memberships)) {
      if (
        m.user_id === currentUserId &&
        m.tenant_id === currentTenantId &&
        m.state === 'active'
      ) {
        for (const rid of m.role_ids) userRoleIds.add(rid);
      }
    }
    const resolved = resolveRolePermissions(Array.from(userRoleIds), roles);
    const hasTenantWrite = resolved.has('dashboard:write');
    const level = resolveDashboardAccess({
      dashboard,
      userId: currentUserId,
      tenantId: currentTenantId,
      roleIds: Array.from(userRoleIds),
      hasTenantWrite,
    });
    if (level !== 'write') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: '/access-denied' as string,
        search: {
          required: ['dashboard:write'],
          requireAny: false,
        } as Record<string, unknown>,
      });
    }
    return true;
  },
  component: DashboardBuilderPage,
});
