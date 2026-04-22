/**
 * <NotificationDetail> — drawer content for a single inbox notification.
 *
 * Sections:
 *   - Header: severity icon + title, category + severity badges, relative +
 *     absolute timestamp (tooltip).
 *   - Body: full text (no truncation).
 *   - Optional action button (external href).
 *   - Metadata: notification_id, tenant_id, user_id (IdBadge + chips).
 *   - Actions: Mark read/unread, Archive/Unarchive.
 *
 * Mark-read and archive are permission-gated on `notification:manage-own`.
 */
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArchive,
  IconArchiveOff,
  IconCircleCheck,
  IconCircleX,
  IconEye,
  IconEyeOff,
  IconInfoCircle,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { IdBadge } from '@/components/id-badge';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useMockStore } from '@/api/mock-store';
import { archive, markRead, unarchive } from '../api';
import type { NotificationItem } from '../types';

dayjs.extend(relativeTime);

const SEVERITY_ICON: Record<NotificationItem['severity'], typeof IconInfoCircle> = {
  info: IconInfoCircle,
  warn: IconAlertTriangle,
  error: IconCircleX,
  success: IconCircleCheck,
};

const SEVERITY_COLOR: Record<NotificationItem['severity'], string> = {
  info: 'blue',
  warn: 'orange',
  error: 'red',
  success: 'green',
};

function formatCategoryLabel(category: string): string {
  if (category.startsWith('plugin:')) {
    return `Plugin · ${category.slice('plugin:'.length)}`;
  }
  if (category.length === 0) return 'Other';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export interface NotificationDetailProps {
  item: NotificationItem;
  onClose: () => void;
}

export function NotificationDetail({ item, onClose: _onClose }: NotificationDetailProps) {
  const canManageOwn = usePermission('notification:manage-own');
  const Icon = SEVERITY_ICON[item.severity];
  const color = SEVERITY_COLOR[item.severity];
  const absolute = dayjs(item.at).format('YYYY-MM-DD HH:mm:ss');
  const relative = dayjs(item.at).fromNow();

  // Look up tenant slug for nicer display; falls back to the raw id.
  const tenants = useMockStore((s) => s.tenants);
  const tenantSlug = item.tenant_id ? tenants[item.tenant_id]?.slug : null;

  async function handleToggleRead() {
    if (!canManageOwn) return;
    try {
      if (item.read_at === null) {
        await markRead(item.id);
        notify.success('Marked as read');
      } else {
        // No first-class "mark unread" mutation — the store already exposes
        // the field; we flip it directly for stage 1. Stage 2 wires this to
        // a real endpoint.
        useMockStore.setState((s) => ({
          notifications: {
            ...s.notifications,
            [item.id]: { ...item, read_at: null, read: false },
          },
        }));
        notify.success('Marked as unread');
      }
    } catch {
      notify.error('Failed', 'Please try again.');
    }
  }

  async function handleToggleArchive() {
    if (!canManageOwn) return;
    try {
      if (item.archived_at === null) {
        await archive(item.id);
        notify.success('Archived');
      } else {
        await unarchive(item.id);
        notify.success('Unarchived');
      }
    } catch {
      notify.error('Failed', 'Please try again.');
    }
  }

  return (
    <Stack gap="md" data-testid="notification-detail">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Stack gap={4} flex={1} miw={0}>
          <Group gap="xs" align="center" wrap="wrap">
            <Icon
              size={20}
              color={`var(--mantine-color-${color}-6)`}
              aria-label={`${item.severity} severity`}
              role="img"
            />
            <Title order={4}>{item.title}</Title>
          </Group>
          <Group gap="xs" align="center" wrap="wrap">
            <Badge size="sm" variant="light" color={color}>
              {item.severity}
            </Badge>
            <Badge size="sm" variant="outline" color="gray">
              {formatCategoryLabel(item.category)}
            </Badge>
            <Tooltip label={absolute} withArrow>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                {relative}
              </Text>
            </Tooltip>
          </Group>
        </Stack>
      </Group>

      <Divider />

      {/* Body */}
      <Text size="sm" data-testid="notification-detail-body">
        {item.body}
      </Text>

      {/* Optional action */}
      {item.action && (
        <Alert
          color={color}
          variant="light"
          icon={<IconAlertCircle size={14} />}
          title="Suggested action"
        >
          <Button
            component="a"
            href={item.action.href}
            size="xs"
            variant="light"
            color={color}
            data-testid="notification-detail-action"
          >
            {item.action.label}
          </Button>
        </Alert>
      )}

      <Divider />

      {/* Metadata */}
      <Stack gap={6}>
        <Text size="xs" fw={600} tt="uppercase" c="var(--mantine-color-gray-7)">
          Metadata
        </Text>
        <Group gap="xs" align="center" wrap="wrap">
          <Text size="xs" fw={500}>
            notification:
          </Text>
          <IdBadge id={item.id} />
        </Group>
        <Group gap="xs" align="center" wrap="wrap">
          <Text size="xs" fw={500}>
            tenant:
          </Text>
          {item.tenant_id === null ? (
            <Badge size="xs" variant="outline" color="violet">
              cross-tenant
            </Badge>
          ) : (
            <>
              {tenantSlug && (
                <Badge size="xs" variant="outline" color="blue">
                  {tenantSlug}
                </Badge>
              )}
              <IdBadge id={item.tenant_id} />
            </>
          )}
        </Group>
        <Group gap="xs" align="center" wrap="wrap">
          <Text size="xs" fw={500}>
            user:
          </Text>
          <IdBadge id={item.user_id} />
        </Group>
      </Stack>

      <Divider />

      {/* Actions */}
      <Box>
        <Group gap="sm">
          <Button
            size="xs"
            variant="default"
            leftSection={item.read_at === null ? <IconEye size={12} /> : <IconEyeOff size={12} />}
            onClick={() => {
              void handleToggleRead();
            }}
            disabled={!canManageOwn}
            data-testid="notification-detail-toggle-read"
          >
            {item.read_at === null ? 'Mark as read' : 'Mark as unread'}
          </Button>
          <Button
            size="xs"
            variant="default"
            leftSection={
              item.archived_at === null ? <IconArchive size={12} /> : <IconArchiveOff size={12} />
            }
            onClick={() => {
              void handleToggleArchive();
            }}
            disabled={!canManageOwn}
            data-testid="notification-detail-toggle-archive"
          >
            {item.archived_at === null ? 'Archive' : 'Unarchive'}
          </Button>
        </Group>
      </Box>
    </Stack>
  );
}
