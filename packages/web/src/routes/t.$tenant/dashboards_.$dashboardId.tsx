/**
 * Per-dashboard viewer — /t/$tenant/dashboards/$dashboardId
 *
 * Read-only grid view. Guarded by dashboard:read. `beforeLoad` additionally
 * enforces scope rules:
 *   - `personal`: only the owner may view → otherwise /access-denied.
 *   - `shared`:   current user's roles must intersect dashboard.shared_role_ids.
 *   - `tenant`:   anyone with dashboard:read in the tenant.
 */
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Button, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  DashboardViewer,
  createDashboard,
} from '@/features/dashboards';
import { useDashboardDetail } from '@/features/dashboards';

function DashboardViewerPage() {
  const { tenant, dashboardId } = Route.useParams();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantSlug = tenantRecord?.slug ?? tenant;
  const tenantId = tenantRecord?.id ?? '';

  const dashboard = useDashboardDetail(dashboardId);

  function handleBack() {
    void navigate({
      to: '/t/$tenant/dashboards',
      params: { tenant: tenantSlug },
    } as unknown as Parameters<typeof navigate>[0]);
  }

  function handleEdit(_id: string) {
    // Full builder ships in Phase 4c.
    notify.info(
      'Builder pending',
      'The dashboard builder ships in Phase 4c.',
    );
  }

  async function handleClone(id: string) {
    if (!dashboard) return;
    try {
      const cloned = await createDashboard(tenantId, {
        name: `${dashboard.name} (copy)`,
        ...(dashboard.description !== undefined
          ? { description: dashboard.description }
          : {}),
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
    // id unused — silence eslint
    void id;
  }

  function handleVersionHistory(_id: string) {
    notify.info(
      'Version history pending',
      'Version history drawer ships in Phase 4d.',
    );
  }

  return (
    <Stack gap={0}>
      <Group p="md" pb={0}>
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={14} />}
          onClick={handleBack}
        >
          All dashboards
        </Button>
      </Group>
      <DashboardViewer
        dashboardId={dashboardId}
        onEdit={handleEdit}
        onClone={(id) => { void handleClone(id); }}
        onVersionHistory={handleVersionHistory}
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/dashboards_/$dashboardId')({
  beforeLoad: (ctx) => {
    // 1. Baseline permission + auth check.
    requirePermissions({ required: ['dashboard:read'] })();

    // 2. Scope enforcement.
    const { params } = ctx;
    const { dashboardId } = params as { dashboardId: string };
    const { dashboards, currentUserId, currentTenantId, memberships } =
      useMockStore.getState();
    const dashboard = dashboards[dashboardId];
    if (!dashboard) {
      // Missing dashboard → let the component render its not-found state.
      return true;
    }
    if (dashboard.tenant_id !== currentTenantId) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: '/access-denied' as string,
        search: {
          required: ['dashboard:read'],
          requireAny: false,
        } as Record<string, unknown>,
      });
    }
    if (dashboard.scope === 'personal') {
      if (dashboard.owner_user_id !== currentUserId) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw redirect({
          to: '/access-denied' as string,
          search: {
            required: ['dashboard:read'],
            requireAny: false,
          } as Record<string, unknown>,
        });
      }
    } else if (dashboard.scope === 'shared') {
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
      const intersects = dashboard.shared_role_ids.some((rid) =>
        userRoleIds.has(rid),
      );
      if (!intersects) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw redirect({
          to: '/access-denied' as string,
          search: {
            required: ['dashboard:read'],
            requireAny: false,
          } as Record<string, unknown>,
        });
      }
    }
    return true;
  },
  component: DashboardViewerPage,
});
