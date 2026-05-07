/**
 * Per-dashboard viewer — /t/$tenant/dashboards/$dashboardId
 *
 * Nested under the dashboards layout (sidebar + outlet). Renders the
 * <DashboardViewer> with edit / delete / clone / export / version-history
 * actions wired up. Delete uses the parent layout's modal via outlet context.
 *
 * Read-only grid view. Guarded by dashboard:read. `beforeLoad` additionally
 * enforces scope rules:
 *   - `personal`: only the owner may view → otherwise /access-denied.
 *   - `shared`:   current user's roles must intersect dashboard.shared_role_ids.
 *   - `tenant`:   anyone with dashboard:read in the tenant.
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  DashboardViewer,
  VersionHistoryDrawer,
  createDashboard,
  setDefaultDashboard,
  useDashboardDetail,
} from '@/features/dashboards';
import { useDashboardsLayoutContext } from './-dashboards-layout-context';

function DashboardViewerPage() {
  const { tenant, dashboardId } = Route.useParams();
  const navigate = useNavigate();
  const { openDelete } = useDashboardsLayoutContext();
  const [historyOpen, setHistoryOpen] = useState(false);

  const tenantSlug = tenant ?? '';
  const tenantId = tenant ?? '';

  const dashboard = useDashboardDetail(dashboardId);

  function handleEdit(id: string) {
    void navigate({
      to: '/t/$tenant/dashboards/$dashboardId/edit',
      params: { tenant: tenantSlug, dashboardId: id },
    } as unknown as Parameters<typeof navigate>[0]);
  }

  async function handleClone(id: string) {
    if (!dashboard) return;
    try {
      const cloned = await createDashboard(tenantId, {
        name: `${dashboard.name} (copy)`,
        ...(dashboard.description !== undefined ? { description: dashboard.description } : {}),
        mode: dashboard.mode,
        scope: dashboard.scope,
        owner_user_id: dashboard.owner_user_id,
        shared_role_ids: [...dashboard.shared_role_ids],
        variables: [...dashboard.variables],
      });
      notify.success('Dashboard cloned', `Created ${cloned.name}.`);
      void navigate({
        to: '/t/$tenant/dashboards/$dashboardId',
        params: { tenant: tenantSlug, dashboardId: cloned.id },
      } as unknown as Parameters<typeof navigate>[0]);
    } catch (e) {
      notify.error('Clone failed', (e as Error).message);
    }
    void id;
  }

  async function handleSetDefault() {
    if (!dashboard) return;
    try {
      await setDefaultDashboard(tenantId, dashboard.id);
      notify.success('Default set', `${dashboard.name} is now the tenant default.`);
    } catch (e) {
      notify.error('Failed to set default', (e as Error).message);
    }
  }

  function handleVersionHistory(_id: string) {
    setHistoryOpen(true);
  }

  function handleDelete() {
    if (!dashboard) return;
    openDelete(dashboard);
  }

  return (
    <>
      <DashboardViewer
        dashboardId={dashboardId}
        onEdit={handleEdit}
        onClone={(id) => {
          void handleClone(id);
        }}
        onDelete={handleDelete}
        onSetDefault={() => {
          void handleSetDefault();
        }}
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
          }}
        />
      )}
    </>
  );
}

export const Route = createFileRoute('/t/$tenant/dashboards/$dashboardId')({
  // Stage-2: dashboard scope (personal/shared/tenant) is enforced by the
  // daemon at fetch time via `dashboard:read`; granular scope-based redirect
  // is no longer applied at the route level. The viewer surfaces a not-found
  // / access-denied state when the daemon rejects the read.
  beforeLoad: requirePermissions({ required: ['dashboard:read'] }),
  component: DashboardViewerPage,
});
