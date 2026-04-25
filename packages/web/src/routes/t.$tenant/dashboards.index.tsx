/**
 * Dashboards index — /t/$tenant/dashboards (exact match).
 *
 * Renders inside the dashboards layout's <Outlet />. Shows a welcome /
 * empty state nudging the user to pick a dashboard from the sidebar or
 * create a new one.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Stack } from '@mantine/core';
import { IconLayoutDashboard } from '@tabler/icons-react';
import { EmptyState } from '@/components/empty-state';

function DashboardsIndexPage() {
  return (
    <Stack gap="md" p="xl" align="center" justify="center" style={{ minHeight: '60vh' }}>
      <EmptyState
        icon={IconLayoutDashboard}
        title="Pick a dashboard"
        description="Select a dashboard from the sidebar to view it, or create a new one."
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/dashboards/')({
  component: DashboardsIndexPage,
});
