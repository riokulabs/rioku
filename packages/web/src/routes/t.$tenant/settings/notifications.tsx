/**
 * Notifications settings index — /t/$tenant/settings/notifications.
 *
 * Landing page for the outbound-notifications subsection (channels, routing
 * rules, delivery log). Shows summary stats cards for each sibling page and
 * links across to them. The three sibling routes (`notification-channels`,
 * `notification-routing`, `notification-delivery`) remain standalone so they
 * keep URL-synced filters and deep-links.
 *
 * Guard: notification-channel:read (read access to the subsection implies
 * read access to at least one sub-feature; finer guards live on each sibling).
 */
import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBell,
  IconInbox,
  IconRoute,
} from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';

function NotificationsSettingsIndexPage() {
  const { tenant } = Route.useParams();

  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const channels = useMockStore((s) => s.notificationChannels);
  const rules = useMockStore((s) => s.notificationRoutingRules);
  const deliveryLog = useMockStore((s) => s.notificationDeliveryLog);

  // ── Channels summary ──
  const channelStats = useMemo(() => {
    let total = 0;
    let enabled = 0;
    for (const c of Object.values(channels)) {
      if (c.tenant_id !== tenantId) continue;
      total += 1;
      if (c.enabled) enabled += 1;
    }
    return { total, enabled };
  }, [channels, tenantId]);

  // ── Routing rules summary ──
  const rulesStats = useMemo(() => {
    let total = 0;
    let enabled = 0;
    for (const r of Object.values(rules)) {
      if (r.tenant_id !== tenantId) continue;
      total += 1;
      if (r.enabled) enabled += 1;
    }
    return { total, enabled };
  }, [rules, tenantId]);

  // ── Delivery log summary (last 24h) ──
  // Capture the 24h cutoff once at first render (pure from React's POV) —
  // stage 1 mock data doesn't shift under our feet.
  const [cutoffAt] = useState(() =>
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );
  const deliveryStats = useMemo(() => {
    let delivered = 0;
    let retrying = 0;
    let failed = 0;
    let pending = 0;
    for (const d of Object.values(deliveryLog)) {
      if (d.tenant_id !== tenantId) continue;
      if (d.last_attempted_at < cutoffAt) continue;
      if (d.status === 'delivered') delivered += 1;
      else if (d.status === 'retrying') retrying += 1;
      else if (d.status === 'failed') failed += 1;
      else pending += 1;
    }
    return { delivered, retrying, failed, pending };
  }, [deliveryLog, tenantId, cutoffAt]);

  return (
    <Stack gap="md" p="md" data-testid="notifications-settings-index">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>

      <Stack gap={4}>
        <Title order={2}>Notifications</Title>
        <Text size="sm">
          Configure outbound notification channels, routing rules, and review
          delivery attempts. In-app inbox lives on the top-bar bell.
        </Text>
      </Stack>

      <Grid>
        {/* Channels card */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder p="md" h="100%">
            <Stack gap="sm" h="100%" justify="space-between">
              <Stack gap="xs">
                <Group gap="xs" align="center">
                  <IconBell size={20} color="var(--mantine-color-blue-6)" />
                  <Title order={4}>Channels</Title>
                </Group>
                <Text size="sm">
                  Outbound endpoints — email, Slack, webhook, PagerDuty, Teams, SMS.
                </Text>
                <Group gap="xs">
                  <Badge variant="light" color="blue">
                    {String(channelStats.total)} total
                  </Badge>
                  <Badge variant="light" color="green">
                    {String(channelStats.enabled)} enabled
                  </Badge>
                </Group>
              </Stack>
              <Box>
                <Button
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
                  component={Link as any}
                  to="/t/$tenant/settings/notification-channels"
                  params={{ tenant: tenantSlug }}
                  rightSection={<IconArrowRight size={14} />}
                  variant="light"
                  size="sm"
                  fullWidth
                >
                  Manage channels
                </Button>
              </Box>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Routing rules card */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder p="md" h="100%">
            <Stack gap="sm" h="100%" justify="space-between">
              <Stack gap="xs">
                <Group gap="xs" align="center">
                  <IconRoute size={20} color="var(--mantine-color-indigo-6)" />
                  <Title order={4}>Routing rules</Title>
                </Group>
                <Text size="sm">
                  Map category and severity patterns to one or more channels.
                </Text>
                <Group gap="xs">
                  <Badge variant="light" color="indigo">
                    {String(rulesStats.total)} total
                  </Badge>
                  <Badge variant="light" color="green">
                    {String(rulesStats.enabled)} enabled
                  </Badge>
                </Group>
              </Stack>
              <Box>
                <Button
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
                  component={Link as any}
                  to="/t/$tenant/settings/notification-routing"
                  params={{ tenant: tenantSlug }}
                  rightSection={<IconArrowRight size={14} />}
                  variant="light"
                  size="sm"
                  fullWidth
                >
                  Manage routing rules
                </Button>
              </Box>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Delivery log card */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder p="md" h="100%">
            <Stack gap="sm" h="100%" justify="space-between">
              <Stack gap="xs">
                <Group gap="xs" align="center">
                  <IconInbox size={20} color="var(--mantine-color-teal-6)" />
                  <Title order={4}>Delivery log</Title>
                </Group>
                <Text size="sm">
                  Read-only history of delivery attempts. Last 24 hours:
                </Text>
                <Group gap="xs">
                  <Badge variant="light" color="green">
                    {String(deliveryStats.delivered)} delivered
                  </Badge>
                  <Badge variant="light" color="yellow">
                    {String(deliveryStats.retrying)} retrying
                  </Badge>
                  <Badge variant="light" color="red">
                    {String(deliveryStats.failed)} failed
                  </Badge>
                  {deliveryStats.pending > 0 && (
                    <Badge variant="light" color="gray">
                      {String(deliveryStats.pending)} pending
                    </Badge>
                  )}
                </Group>
              </Stack>
              <Box>
                <Button
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
                  component={Link as any}
                  to="/t/$tenant/settings/notification-delivery"
                  params={{ tenant: tenantSlug }}
                  rightSection={<IconArrowRight size={14} />}
                  variant="light"
                  size="sm"
                  fullWidth
                >
                  View delivery log
                </Button>
              </Box>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/notifications')({
  beforeLoad: requirePermissions({
    required: ['notification-channel:read'],
  }),
  component: NotificationsSettingsIndexPage,
});
