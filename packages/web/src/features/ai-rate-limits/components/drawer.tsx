/**
 * <RateLimitDrawer> — quick-info drawer body for an AI semantic rate-limit.
 *
 * Renders a compact summary (name, scope chip, action badge, enabled
 * Switch, threshold/window/max key facts) with an "Open full page" button
 * that navigates to `/t/$tenant/ai/rate-limits/$limitId`. Used as the
 * right-side drawer body on the rate-limits list page.
 */
import { Badge, Button, Divider, Group, Stack, Switch, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { IconArrowRight, IconGauge } from '@tabler/icons-react';
import { useRateLimitDetail } from '../api';
import type { AiSemanticRateLimit } from '@/api/resources';

const ACTION_COLORS: Record<AiSemanticRateLimit['action'], string> = {
  block: 'red',
  degrade: 'yellow',
  log: 'blue',
};

function formatWindow(seconds: number): string {
  if (seconds % 3600 === 0) return `${String(seconds / 3600)}h`;
  if (seconds % 60 === 0) return `${String(seconds / 60)}m`;
  return `${String(seconds)}s`;
}

export interface RateLimitDrawerProps {
  /** Rate-limit id to show. */
  ruleId: string;
  /** Tenant id for the API call. */
  tenantId: string;
  /** Tenant slug used for the "Open full page" deep link. */
  tenantSlug: string;
}

export function RateLimitDrawer({ ruleId, tenantId, tenantSlug }: RateLimitDrawerProps) {
  const rule = useRateLimitDetail(tenantId, ruleId);

  if (!rule) {
    return (
      <Stack gap="sm" data-testid="rate-limit-drawer-empty">
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Rate limit not found.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md" data-testid="rate-limit-drawer">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <IconGauge size={22} color="var(--mantine-color-teal-6)" />
          <Stack gap={2}>
            <Title order={5} ff="monospace">
              {rule.name}
            </Title>
            <Group gap="xs">
              <Badge size="sm" variant="outline" color="gray">
                {rule.scope}
              </Badge>
              <Badge size="sm" variant="light" color={ACTION_COLORS[rule.action]}>
                {rule.action}
              </Badge>
              <Badge size="sm" variant="light" color={rule.enabled ? 'green' : 'gray'}>
                {rule.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
          </Stack>
        </Group>
        <Switch
          checked={rule.enabled}
          readOnly
          aria-label={`Enabled state for ${rule.name}`}
        />
      </Group>

      {rule.description && (
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {rule.description}
        </Text>
      )}

      <Divider label="Quick facts" labelPosition="left" />

      <Stack gap={4} data-testid="rate-limit-drawer-facts">
        <Group gap="xs">
          <Text size="xs" fw={600}>
            Threshold
          </Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {rule.similarity_threshold.toFixed(3)}
          </Text>
        </Group>
        <Group gap="xs">
          <Text size="xs" fw={600}>
            Window
          </Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {formatWindow(rule.window_seconds)}
          </Text>
        </Group>
        <Group gap="xs">
          <Text size="xs" fw={600}>
            Max matches
          </Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {String(rule.max_matches)}
          </Text>
        </Group>
        <Group gap="xs">
          <Text size="xs" fw={600}>
            Exemplars
          </Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {String(rule.exemplars.length)}
          </Text>
        </Group>
      </Stack>

      <Group justify="flex-end">
        <Button
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/ai/rate-limits/$limitId"
          params={{ tenant: tenantSlug, limitId: rule.id }}
          rightSection={<IconArrowRight size={14} />}
          size="sm"
          data-testid="rate-limit-drawer-open-full-page"
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}
