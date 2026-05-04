/**
 * Dashboards parent layout — /t/$tenant/dashboards
 *
 * Pure outlet container. The dashboards list lives in the AppShell secondary
 * nav panel (see <AnalyticsNavPanel>), so this layout just renders the active
 * dashboard view + a shared delete-confirmation modal exposed via context.
 *
 * Permission guard: dashboard:read.
 */
import { useMemo, useState } from 'react';
import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Box, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import { deleteDashboard } from '@/features/dashboards';
import type { Dashboard } from '@/features/dashboards/types';
import { DashboardsLayoutContext, type DashboardsRouteContext } from './-dashboards-layout-context';

export { useDashboardsLayoutContext } from './-dashboards-layout-context';

function DashboardsLayoutPage() {
  const { tenant } = Route.useParams();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const [deleteTarget, setDeleteTarget] = useState<Dashboard | null>(null);
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  function handleOpenDelete(d: Dashboard) {
    setDeleteTarget(d);
    openDelete();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDashboard(deleteTarget.id);
      notify.success('Dashboard deleted', deleteTarget.name);
      void navigate({
        to: '/t/$tenant/dashboards',
        params: { tenant: tenantSlug },
      } as unknown as Parameters<typeof navigate>[0]);
      closeDelete();
      setDeleteTarget(null);
    } catch (e) {
      notify.error('Delete failed', (e as Error).message);
    }
  }

  const outletContext: DashboardsRouteContext = useMemo(
    () => ({ openDelete: handleOpenDelete }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <DashboardsLayoutContext.Provider value={outletContext}>
      <Box style={{ minWidth: 0, height: '100%' }}>
        <Outlet />
      </Box>

      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteTarget(null);
        }}
        title="Delete dashboard?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            This will permanently delete <strong>{deleteTarget?.name}</strong>, its widgets, and its
            version history. This action cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                closeDelete();
                setDeleteTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                void confirmDelete();
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </DashboardsLayoutContext.Provider>
  );
}

export const Route = createFileRoute('/t/$tenant/dashboards')({
  beforeLoad: requirePermissions({ required: ['dashboard:read'] }),
  component: DashboardsLayoutPage,
});
