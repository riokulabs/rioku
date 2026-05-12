/**
 * Dashboard builder route — /t/$tenant/dashboards/$dashboardId/edit
 *
 * Full-page interactive builder. Guarded by `dashboard:write`
 * and the same scope rules as the viewer: personal dashboards must match the
 * owner; shared dashboards must intersect the user's role ids.
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { DashboardBuilderShell } from '@/features/dashboard-builder';
import { VersionHistoryDrawer, useDashboardDetail } from '@/features/dashboards';

function DashboardBuilderPage() {
  const { tenant, dashboardId } = Route.useParams();
  const navigate = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false);

  const tenantSlug = tenant;
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
  // Stage-2: tenant-level dashboard:write is the gate; per-dashboard scope is
  // enforced by the daemon at write time (PATCH/PUT). The builder surfaces an
  // error state when the daemon rejects the mutation.
  beforeLoad: requirePermissions({ required: ['dashboard:write'] }),
  component: DashboardBuilderPage,
});
