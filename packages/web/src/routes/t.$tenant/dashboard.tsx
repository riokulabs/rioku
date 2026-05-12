/**
 * Tenant home — /t/$tenant/dashboard
 *
 * Resolution order:
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
import { EmptyState } from '@/components/empty-state';
import { Zone } from '@/components/zone';
import { IconActivity } from '@tabler/icons-react';
import { DashboardViewer, useUserHomeDashboard, useDashboardList } from '@/features/dashboards';
import { useServiceList } from '@/features/services';
import { useSiteList } from '@/features/sites';
import { useUserList } from '@/features/security/users';
import { useAuditList } from '@/features/audit';
import { useCurrentUser } from '@/features/auth/use-current-user';

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

function StockDashboard({ tenantId }: { tenantId: string }) {
  const services = useServiceList(tenantId, {
    search: '',
    env: [],
    health: [],
    tags: [],
  });
  const usersResult = useUserList(tenantId, { search: '', status: 'all' });
  const users = usersResult.items;
  const sites = useSiteList(tenantId, {
    search: '',
    tls_mode: [],
    enabled: [],
    linked_service_ids: [],
  });
  const audit = useAuditList(tenantId, {
    actions: [],
    outcomes: [],
    resource_types: [],
    tiers: [],
    date_from: null,
    date_to: null,
    actor_handles: [],
    resource_id_handles: [],
    search: '',
  });

  const todayStart = dayjs().startOf('day');
  const todayAuditCount = audit.filter((e) => dayjs(e.at).isAfter(todayStart)).length;
  const recentAudit = [...audit].reverse().slice(0, 10);

  const servicesCount = services.length;
  const usersCount = users.length;
  const sitesCount = sites.length;

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
              const actor = users.find((u) => u.user.id === entry.actor_id);
              const actorName = actor?.user.name ?? entry.actor_id;
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
  const { tenant } = Route.useParams();
  const tenantId = tenant;
  const currentUser = useCurrentUser().data ?? null;
  const currentUserId = currentUser?.id ?? null;
  const dashboards = useDashboardList(tenantId, {
    search: '',
    modes: [],
    scopes: [],
  });
  const userHomeId = useUserHomeDashboard(currentUserId ?? '');

  // 1. User's explicit home override (if it still exists and belongs to the
  //    active tenant).
  if (userHomeId) {
    const home = dashboards.find((d) => d.id === userHomeId);
    if (home) {
      return <DashboardViewer dashboardId={userHomeId} hideMakeHome />;
    }
  }

  // 2. Tenant default dashboard.
  const tenantDefault = dashboards.find((d) => d.default);
  if (tenantDefault) {
    return <DashboardViewer dashboardId={tenantDefault.id} hideMakeHome />;
  }

  // 3. Stock placeholder.
  return <StockDashboard tenantId={tenantId} />;
}

export const Route = createFileRoute('/t/$tenant/dashboard')({
  component: DashboardPage,
});
