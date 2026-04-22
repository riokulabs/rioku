/**
 * <NotificationsSection> — Settings Notifications section.
 *
 * Tenant-scoped notification configuration:
 *   1. Global toggles — master kill switch, opt-in mode, plugin categories
 *   2. Retry policy — max retries, backoff seconds
 *   3. Summary cards — channel count, routing rule count, delivery success rate
 *   4. Sub-page links — Channels, Routing rules, Delivery log
 *
 * Requires `notification:admin` for writes.
 * Requires `notification-channel:read` + `notification-routing:read` + `notification-log:read`
 * for the summary cards (non-blocking; cards degrade gracefully without count data).
 *
 * Task (notifications) — tenant-scoped notification config.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import {
  IconAlertCircle,
  IconArrowRight,
  IconBell,
  IconBellOff,
  IconChartBar,
  IconListCheck,
  IconMail,
} from '@tabler/icons-react';
import { Link, useSearch } from '@tanstack/react-router';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { StatusBadge } from '@/components/status-badge';
import {
  useCurrentNotificationConfig,
  useCurrentTenant,
  useDeliveryLogSummary,
  useNotificationChannelCount,
  useNotificationRoutingRuleCount,
  updateTenantNotificationConfig,
} from '../api';
import { tenantNotificationConfigSchema } from '../schemas';
import type { TenantNotificationConfigValues } from '../schemas';

// ─── Opt-in mode options ──────────────────────────────────────────────────────

const OPT_IN_MODE_DATA: { label: string; value: string }[] = [
  { label: 'Opt-out (users receive unless they mute)', value: 'opt-out' },
  { label: 'Opt-in (users must subscribe per category)', value: 'opt-in' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function NotificationsSection() {
  const canAdmin = usePermission('notification:admin');
  const tenant = useCurrentTenant();
  const config = useCurrentNotificationConfig();
  const channelCount = useNotificationChannelCount();
  const routingRuleCount = useNotificationRoutingRuleCount();
  const deliverySummary = useDeliveryLogSummary();

  // Derive tenant slug for sub-page links — see SettingsLayout for same pattern.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search: any = useSearch({ strict: false });
  void search; // consumed by the router; kept here to avoid unused-import

  const tenantSlug = tenant?.slug ?? '';

  // ── Form ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const form = useForm<TenantNotificationConfigValues>({
    initialValues: {
      enabled: config?.enabled ?? true,
      opt_in_mode: config?.opt_in_mode ?? 'opt-out',
      plugins_can_register_categories: config?.plugins_can_register_categories ?? true,
      max_retries: config?.max_retries ?? 3,
      retry_backoff_seconds: config?.retry_backoff_seconds ?? 30,
    },
    validate: schemaResolver(tenantNotificationConfigSchema, { sync: true }),
  });

  // Reset form when config changes (e.g. after tenant switch).
  useEffect(() => {
    if (!config) return;
    form.setValues({
      enabled: config.enabled,
      opt_in_mode: config.opt_in_mode,
      plugins_can_register_categories: config.plugins_can_register_categories,
      max_retries: config.max_retries,
      retry_backoff_seconds: config.retry_backoff_seconds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.tenant_id]);

  const handleSubmit = useCallback(
    async (values: TenantNotificationConfigValues) => {
      if (!tenant) return;
      setLoading(true);
      setSaveError(null);
      try {
        await updateTenantNotificationConfig(tenant.id, values);
        notify.success('Notification settings saved', 'Tenant notification configuration updated.');
        form.resetDirty(values);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save notification settings';
        setSaveError(msg);
      } finally {
        setLoading(false);
      }
    },
    [tenant, form],
  );

  // ── Loading / not-found ───────────────────────────────────────────────────

  if (!tenant || !config) {
    return (
      <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="notifications-loading">
        Loading notification settings…
      </Text>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Stack gap="xl" data-testid="notifications-section">
      {/* ── 1. Global toggles + retry policy ────────────────────────────── */}
      <form
        onSubmit={form.onSubmit((v) => {
          void handleSubmit(v);
        })}
        data-testid="notifications-config-form"
      >
        <Stack gap="lg">
          {saveError && (
            <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" py="xs">
              {saveError}
            </Alert>
          )}

          {/* ── Master switch ────────────────────────────────────────────── */}
          <Stack gap="sm">
            <Title order={5}>Global toggles</Title>

            <Group gap="sm" align="center">
              {form.values.enabled ? <IconBell size={16} /> : <IconBellOff size={16} />}
              <Tooltip
                label="You need notification:admin to change this"
                disabled={canAdmin}
                withArrow
              >
                <span>
                  <Switch
                    label="Notifications enabled"
                    description="Master kill switch — when off, no notifications are dispatched tenant-wide."
                    disabled={!canAdmin}
                    checked={form.values.enabled}
                    onChange={(e) => {
                      form.setFieldValue('enabled', e.currentTarget.checked);
                    }}
                    data-testid="notifications-enabled-switch"
                  />
                </span>
              </Tooltip>
            </Group>

            <Tooltip
              label="You need notification:admin to change this"
              disabled={canAdmin}
              withArrow
            >
              <span style={{ alignSelf: 'flex-start', maxWidth: 380 }}>
                <Select
                  label="User opt-in mode"
                  description="Controls how users subscribe to notification categories."
                  data={OPT_IN_MODE_DATA}
                  disabled={!canAdmin}
                  data-testid="notifications-opt-in-mode-select"
                  {...form.getInputProps('opt_in_mode')}
                />
              </span>
            </Tooltip>

            <Tooltip
              label="You need notification:admin to change this"
              disabled={canAdmin}
              withArrow
            >
              <span>
                <Switch
                  label="Allow plugins to register categories"
                  description="When enabled, installed plugins can register their own notification categories."
                  disabled={!canAdmin}
                  checked={form.values.plugins_can_register_categories}
                  onChange={(e) => {
                    form.setFieldValue('plugins_can_register_categories', e.currentTarget.checked);
                  }}
                  data-testid="notifications-plugins-categories-switch"
                />
              </span>
            </Tooltip>
          </Stack>

          <Divider />

          {/* ── Retry policy ─────────────────────────────────────────────── */}
          <Stack gap="sm">
            <Title order={5}>Retry policy</Title>
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Controls how failed delivery attempts are retried before the log entry is marked
              failed.
            </Text>

            <Group gap="md" align="flex-end" wrap="wrap">
              <Tooltip
                label="You need notification:admin to change this"
                disabled={canAdmin}
                withArrow
              >
                <span>
                  <NumberInput
                    label="Max retries"
                    description="0 = no retries; max 10."
                    min={0}
                    max={10}
                    step={1}
                    disabled={!canAdmin}
                    style={{ width: 160 }}
                    data-testid="notifications-max-retries-input"
                    {...form.getInputProps('max_retries')}
                  />
                </span>
              </Tooltip>

              <Tooltip
                label="You need notification:admin to change this"
                disabled={canAdmin}
                withArrow
              >
                <span>
                  <NumberInput
                    label="Retry backoff (seconds)"
                    description="Base interval between retries. 1–3600."
                    min={1}
                    max={3600}
                    step={5}
                    disabled={!canAdmin}
                    style={{ width: 200 }}
                    data-testid="notifications-retry-backoff-input"
                    {...form.getInputProps('retry_backoff_seconds')}
                  />
                </span>
              </Tooltip>
            </Group>
          </Stack>

          {/* ── Save ─────────────────────────────────────────────────────── */}
          {form.isDirty() && (
            <Group>
              <Tooltip label="You need notification:admin to save" disabled={canAdmin} withArrow>
                <span>
                  <Button
                    type="submit"
                    loading={loading}
                    disabled={!canAdmin}
                    size="sm"
                    data-testid="notifications-save-btn"
                  >
                    Save
                  </Button>
                </span>
              </Tooltip>
            </Group>
          )}
        </Stack>
      </form>

      <Divider />

      {/* ── 2. Delivery summary ──────────────────────────────────────────── */}
      <Stack gap="sm">
        <Title order={5}>Delivery summary</Title>
        <Group gap="md" wrap="wrap" data-testid="notifications-delivery-summary">
          <Card withBorder radius="sm" p="sm" style={{ minWidth: 140 }}>
            <Stack gap={4}>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Total deliveries
              </Text>
              <Text fw={600} size="lg" data-testid="notifications-summary-total">
                {deliverySummary.total}
              </Text>
            </Stack>
          </Card>
          <Card withBorder radius="sm" p="sm" style={{ minWidth: 140 }}>
            <Stack gap={4}>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Success rate
              </Text>
              {deliverySummary.successRate !== null ? (
                <Group gap="xs" align="center">
                  <Text fw={600} size="lg" data-testid="notifications-summary-success-rate">
                    {deliverySummary.successRate}%
                  </Text>
                  <StatusBadge
                    kind={
                      deliverySummary.successRate >= 90
                        ? 'active'
                        : deliverySummary.successRate >= 70
                          ? 'warn'
                          : 'error'
                    }
                    size="xs"
                  >
                    {deliverySummary.successRate >= 90
                      ? 'healthy'
                      : deliverySummary.successRate >= 70
                        ? 'degraded'
                        : 'poor'}
                  </StatusBadge>
                </Group>
              ) : (
                <Text
                  size="sm"
                  c="var(--mantine-color-gray-7)"
                  data-testid="notifications-summary-success-rate"
                >
                  no data
                </Text>
              )}
            </Stack>
          </Card>
          <Card withBorder radius="sm" p="sm" style={{ minWidth: 140 }}>
            <Stack gap={4}>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Active channels
              </Text>
              <Group gap="xs" align="center">
                <Text fw={600} size="lg" data-testid="notifications-summary-channel-count">
                  {channelCount}
                </Text>
                <Badge size="xs" variant="light" color="blue">
                  configured
                </Badge>
              </Group>
            </Stack>
          </Card>
          <Card withBorder radius="sm" p="sm" style={{ minWidth: 140 }}>
            <Stack gap={4}>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Routing rules
              </Text>
              <Text fw={600} size="lg" data-testid="notifications-summary-routing-count">
                {routingRuleCount}
              </Text>
            </Stack>
          </Card>
        </Group>
      </Stack>

      <Divider />

      {/* ── 3. Sub-page links ────────────────────────────────────────────── */}
      <Stack gap="sm">
        <Title order={5}>Notification sub-pages</Title>
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Full CRUD for channels, routing rules, and the delivery log lives on dedicated pages.
        </Text>

        <Group gap="md" wrap="wrap" data-testid="notifications-subpage-cards">
          {/* Channels */}
          <Card withBorder radius="sm" p="md" style={{ minWidth: 200, maxWidth: 260 }}>
            <Stack gap="xs">
              <Group gap="xs">
                <IconMail size={16} />
                <Text fw={500} size="sm">
                  Channels
                </Text>
              </Group>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                {channelCount} channel{channelCount !== 1 ? 's' : ''} configured (SMTP, Slack,
                webhook, …)
              </Text>
              <Button
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                component={Link as any}
                to="/t/$tenant/settings/notification-channels"
                params={{ tenant: tenantSlug }}
                rightSection={<IconArrowRight size={12} />}
                variant="light"
                size="xs"
                data-testid="notifications-link-channels"
              >
                Manage channels
              </Button>
            </Stack>
          </Card>

          {/* Routing rules */}
          <Card withBorder radius="sm" p="md" style={{ minWidth: 200, maxWidth: 260 }}>
            <Stack gap="xs">
              <Group gap="xs">
                <IconListCheck size={16} />
                <Text fw={500} size="sm">
                  Routing rules
                </Text>
              </Group>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                {routingRuleCount} rule{routingRuleCount !== 1 ? 's' : ''} — match events to
                channels
              </Text>
              <Button
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                component={Link as any}
                to="/t/$tenant/settings/notification-routing"
                params={{ tenant: tenantSlug }}
                rightSection={<IconArrowRight size={12} />}
                variant="light"
                size="xs"
                data-testid="notifications-link-routing"
              >
                Manage routing
              </Button>
            </Stack>
          </Card>

          {/* Delivery log */}
          <Card withBorder radius="sm" p="md" style={{ minWidth: 200, maxWidth: 260 }}>
            <Stack gap="xs">
              <Group gap="xs">
                <IconChartBar size={16} />
                <Text fw={500} size="sm">
                  Delivery log
                </Text>
              </Group>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                {deliverySummary.total} total entr{deliverySummary.total !== 1 ? 'ies' : 'y'}{' '}
                recorded
              </Text>
              <Button
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                component={Link as any}
                to="/t/$tenant/notifications"
                params={{ tenant: tenantSlug }}
                rightSection={<IconArrowRight size={12} />}
                variant="light"
                size="xs"
                data-testid="notifications-link-log"
              >
                View log
              </Button>
            </Stack>
          </Card>
        </Group>
      </Stack>
    </Stack>
  );
}
