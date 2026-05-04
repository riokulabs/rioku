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
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  DashboardViewer,
  VersionHistoryDrawer,
  createDashboard,
  setDefaultDashboard,
  useDashboardDetail,
} from '@/features/dashboards';
import { resolveDashboardAccess } from '@/features/dashboards/access';
import { useDashboardsLayoutContext } from './-dashboards-layout-context';

function DashboardViewerPage() {
  const { tenant, dashboardId } = Route.useParams();
  const navigate = useNavigate();
  const { openDelete } = useDashboardsLayoutContext();
  const [historyOpen, setHistoryOpen] = useState(false);

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantSlug = tenantRecord?.slug ?? tenant;
  const tenantId = tenantRecord?.id ?? '';

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
  beforeLoad: (ctx) => {
    requirePermissions({ required: ['dashboard:read'] })();

    const { params } = ctx;
    const { dashboardId } = params as { dashboardId: string };
    const { dashboards, currentUserId, currentTenantId, memberships } = useMockStore.getState();
    const dashboard = dashboards[dashboardId];
    if (!dashboard) {
      return true;
    }

    // Resolve effective access via the centralised access helper. We don't
    // need tenant-write here — read access is sufficient for the viewer.
    const roleIds = new Set<string>();
    for (const m of Object.values(memberships)) {
      if (m.user_id === currentUserId && m.tenant_id === currentTenantId && m.state === 'active') {
        for (const rid of m.role_ids) roleIds.add(rid);
      }
    }
    const level = resolveDashboardAccess({
      dashboard,
      userId: currentUserId,
      tenantId: currentTenantId,
      roleIds: Array.from(roleIds),
      hasTenantWrite: false,
    });
    if (level === 'none') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: '/access-denied' as string,
        search: {
          required: ['dashboard:read'],
          requireAny: false,
        } as Record<string, unknown>,
      });
    }
    return true;
  },
  component: DashboardViewerPage,
});
