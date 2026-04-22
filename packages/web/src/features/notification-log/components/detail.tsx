/**
 * <DeliveryLogDetail> — drawer content for a delivery log entry.
 *
 * Renders:
 *   - Status + attempts + first/last attempted
 *   - Notification preview (joined from the inbox store) + link to the full
 *     inbox entry when it still exists
 *   - Channel name + kind
 *   - Error message for failed / retrying attempts
 */
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Anchor,
  Badge,
  Divider,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconExternalLink, IconInbox } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';
import { useDeliveryLogDetail } from '../api';
import type { NotificationDeliveryLogEntry } from '@/api/resources/types';

dayjs.extend(relativeTime);

const STATUS_COLOR: Record<NotificationDeliveryLogEntry['status'], string> = {
  delivered: 'green',
  retrying: 'yellow',
  failed: 'red',
  pending: 'gray',
};

interface DeliveryLogDetailProps {
  entryId: string;
  tenantSlug: string;
  onClose: () => void;
}

export function DeliveryLogDetail({
  entryId,
  tenantSlug,
  onClose: _onClose,
}: DeliveryLogDetailProps) {
  const entry = useDeliveryLogDetail(entryId);
  const notifications = useMockStore((s) => s.notifications);
  const channels = useMockStore((s) => s.notificationChannels);

  if (!entry) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Delivery entry not found.
      </Alert>
    );
  }

  const notification = notifications[entry.notification_id];
  const channel = channels[entry.channel_id];
  const errorMessage = entry.error_message ?? entry.error;
  const isErrored = entry.status === 'failed' || entry.status === 'retrying';

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconInbox size={28} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={5} ff="monospace">
                {entry.id}
              </Title>
              <Badge size="sm" variant="light" color={STATUS_COLOR[entry.status]}>
                {entry.status}
              </Badge>
            </Group>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Attempt count: {String(entry.attempts)}
            </Text>
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* Timing */}
      <Stack gap={4}>
        <Text size="sm" fw={600}>
          Timing
        </Text>
        <Group gap="md">
          <Text size="xs" c="var(--mantine-color-gray-7)">
            First attempt:{' '}
            <Text component="span" ff="monospace">
              {dayjs(entry.first_attempted_at).format('YYYY-MM-DD HH:mm:ss')}
            </Text>
          </Text>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Last attempt:{' '}
            <Text component="span" ff="monospace">
              {dayjs(entry.last_attempted_at).format('YYYY-MM-DD HH:mm:ss')}
            </Text>
          </Text>
        </Group>
      </Stack>

      <Divider />

      {/* Channel */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Channel
        </Text>
        {channel ? (
          <Group gap="xs">
            <Text size="sm">{channel.name}</Text>
            <Badge size="xs" variant="light" color="blue">
              {channel.kind}
            </Badge>
          </Group>
        ) : (
          <Text size="xs" c="var(--mantine-color-gray-7)" ff="monospace">
            {entry.channel_id} (channel no longer exists)
          </Text>
        )}
      </Stack>

      <Divider />

      {/* Notification preview */}
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            Notification
          </Text>
          {notification && (
            <Anchor
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
              component={Link as any}
              to="/t/$tenant/notifications"
              params={{ tenant: tenantSlug }}
              size="xs"
            >
              <Group gap={4} align="center">
                <span>Open inbox</span>
                <IconExternalLink size={12} />
              </Group>
            </Anchor>
          )}
        </Group>
        {notification ? (
          <Stack gap={4}>
            <Group gap="xs">
              <Badge size="xs" variant="light" color="gray">
                {notification.category}
              </Badge>
              <Badge size="xs" variant="outline" color={STATUS_COLOR[entry.status]}>
                {notification.severity}
              </Badge>
            </Group>
            <Text size="sm" fw={500}>
              {notification.title}
            </Text>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              {notification.body}
            </Text>
          </Stack>
        ) : (
          <Text size="xs" c="var(--mantine-color-gray-7)" ff="monospace">
            {entry.notification_id} (notification not retained)
          </Text>
        )}
      </Stack>

      {isErrored && (
        <>
          <Divider />
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Error
            </Text>
            <Alert color="red" variant="light" icon={<IconAlertCircle size={14} />}>
              <Text size="xs" ff="monospace">
                {errorMessage ?? 'No error message recorded.'}
              </Text>
            </Alert>
          </Stack>
        </>
      )}
    </Stack>
  );
}
