/**
 * Tenant home — /t/$tenant/dashboard
 *
 * Resolution order (Plan 4 Task 4b.13):
 *   1. The current user's per-user home override (userHomeDashboards[userId]).
 *   2. The tenant's system-default dashboard (default: true).
 *   3. A stock placeholder with summary cards + recent audit entries.
 *
 * When either (1) or (2) resolves, the route renders <DashboardViewer> inline
 * instead of redirecting — so the URL stays on /t/$tenant/dashboard. This
 * keeps the "home" feel and avoids a jarring URL change when a user's home
 * dashboard changes under them.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Title, SimpleGrid, Card, Text, Stack, Group, Badge } from '@mantine/core';
import dayjs from 'dayjs';
import { useMockStore } from '@/api/mock-store';
import { EmptyState } from '@/components/empty-state';
import { Zone } from '@/components/zone';
import { IconActivity } from '@tabler/icons-react';
import { DashboardViewer, useUserHomeDashboard } from '@/features/dashboards';
import type { Dashboard } from '@/api/resources/types';

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <Card withBorder radius="md" p="md">
      <Text size="sm" tt="uppercase" fw={700} mb={4}>
        {label}
      </Text>
      <Text size="xl" fw={700}>
        {value}
      </Text>
    </Card>
  );
}

// ─── Placeholder (stock) dashboard ────────────────────────────────────────────

function StockDashboard() {
  const services = useMockStore((s) => s.services);
  const users = useMockStore((s) => s.users);
  const sites = useMockStore((s) => s.sites);
  const audit = useMockStore((s) => s.audit);

  const todayStart = dayjs().startOf('day');
  const todayAuditCount = audit.filter((e) => dayjs(e.at).isAfter(todayStart)).length;
  const recentAudit = [...audit].reverse().slice(0, 10);

  const servicesCount = Object.keys(services).length;
  const usersCount = Object.keys(users).length;
  const sitesCount = Object.keys(sites).length;

  return (
    <Stack gap="xl" p="md">
      <Title order={1}>Dashboard</Title>

      <Zone id="dashboard.summary" />

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
        <StatCard label="Services" value={servicesCount} />
        <StatCard label="Users" value={usersCount} />
        <StatCard label="Sites" value={sitesCount} />
        <StatCard label="Audit entries today" value={todayAuditCount} />
      </SimpleGrid>

      <Stack gap="sm">
        <Title order={3}>Recent activity</Title>

        {recentAudit.length === 0 ? (
          <EmptyState icon={IconActivity} title="No activity yet" />
        ) : (
          <Stack gap="xs">
            {recentAudit.map((entry) => {
              const actor = users[entry.actor_id];
              const actorName = actor?.name ?? entry.actor_id;
              const timestamp = dayjs(entry.at).format('MMM D, HH:mm');
              return (
                <Card key={entry.id} withBorder radius="sm" p="xs">
                  <Group gap="xs" wrap="nowrap">
                    <Badge
                      size="xs"
                      color={
                        entry.outcome === 'success'
                          ? 'green'
                          : entry.outcome === 'denied'
                            ? 'orange'
                            : 'red'
                      }
                      variant="light"
                    >
                      {entry.outcome}
                    </Badge>
                    <Text size="sm" style={{ flex: 1 }} truncate>
                      <Text span fw={600}>
                        {actorName}
                      </Text>{' '}
                      {entry.action} {entry.resource_type}
                    </Text>
                    <Text size="xs" style={{ whiteSpace: 'nowrap' }}>
                      {timestamp}
                    </Text>
                  </Group>
                </Card>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function DashboardPage() {
  const currentUserId = useMockStore((s) => s.currentUserId);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  const dashboards = useMockStore((s) => s.dashboards);
  const userHomeId = useUserHomeDashboard(currentUserId ?? '');

  // 1. User's explicit home override (if it still exists and belongs to the
  //    active tenant).
  if (userHomeId) {
    const home = dashboards[userHomeId];
    if (home?.tenant_id === currentTenantId) {
      return <DashboardViewer dashboardId={userHomeId} />;
    }
  }

  // 2. Tenant default dashboard.
  let tenantDefault: Dashboard | undefined;
  for (const d of Object.values(dashboards)) {
    if (d.tenant_id === currentTenantId && d.default) {
      tenantDefault = d;
      break;
    }
  }
  if (tenantDefault) {
    return <DashboardViewer dashboardId={tenantDefault.id} />;
  }

  // 3. Stock placeholder.
  return <StockDashboard />;
}

export const Route = createFileRoute('/t/$tenant/dashboard')({
  component: DashboardPage,
});
