/**
 * <ChannelDetail> — drawer content for a notification channel.
 *
 * Sections:
 *   - Header (name, kind badge, enabled Switch)
 *   - Configuration (read-only via <ChannelKindConfigPanel readOnly>)
 *   - <TestPanel>
 *   - Recent deliveries via this channel (last 10 from the delivery log)
 *   - Audit tail
 *   - Actions (Edit, Delete — typed-name confirm)
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconBell,
  IconBrandSlack,
  IconBrandTeams,
  IconDeviceMobile,
  IconMail,
  IconUrgent,
  IconWebhook,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import type { NotificationChannel } from '@/api/resources/types';
import { deleteChannel, updateChannel, useChannelDetail } from '../api';
import { ChannelKindConfigPanel } from './kind-config-panel';
import { TestPanel } from './test-panel';

dayjs.extend(relativeTime);

const KIND_COLORS: Record<NotificationChannel['kind'], string> = {
  email: 'blue',
  slack: 'grape',
  webhook: 'cyan',
  pagerduty: 'red',
  teams: 'indigo',
  sms: 'teal',
};

const KIND_ICONS = {
  email: IconMail,
  slack: IconBrandSlack,
  webhook: IconWebhook,
  pagerduty: IconUrgent,
  teams: IconBrandTeams,
  sms: IconDeviceMobile,
} as const;

const STATUS_COLOR: Record<string, string> = {
  delivered: 'green',
  retrying: 'yellow',
  failed: 'red',
  pending: 'gray',
};

interface ChannelDetailProps {
  channelId: string;
  onEdit: () => void;
  onClose: () => void;
}

export function ChannelDetail({ channelId, onEdit, onClose }: ChannelDetailProps) {
  const channel = useChannelDetail(channelId);
  const deliveryLog = useMockStore((s) => s.notificationDeliveryLog);
  const auditEntries = useMockStore((s) => s.audit);

  const canWrite = usePermission('notification-channel:write');

  const recentDeliveries = useMemo(() => {
    if (!channel) return [];
    return Object.values(deliveryLog)
      .filter((e) => e.channel_id === channel.id)
      .slice()
      .sort((a, b) => b.last_attempted_at.localeCompare(a.last_attempted_at))
      .slice(0, 10);
  }, [deliveryLog, channel]);

  const auditTail = useMemo(() => {
    if (!channel) return [];
    return auditEntries
      .filter((e) => e.resource_type === 'notification-channel' && e.resource_id === channel.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, channel]);

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!channel) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Channel not found.
      </Alert>
    );
  }

  // Capture the narrowed channel for closures that run after render.
  const definedChannel = channel;
  const KindIcon = KIND_ICONS[definedChannel.kind];

  async function handleToggle(enabled: boolean) {
    try {
      await updateChannel(channelId, { enabled });
    } catch {
      notify.error('Failed to update channel', 'Please try again.');
    }
  }

  async function handleDelete() {
    if (deleteInput !== definedChannel.name) return;
    setDeleting(true);
    try {
      await deleteChannel(channelId);
      notify.success('Channel deleted', `${definedChannel.name} was removed.`);
      closeDelete();
      onClose();
    } catch {
      notify.error('Failed to delete channel', 'Please try again.');
    } finally {
      setDeleting(false);
      setDeleteInput('');
    }
  }

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <KindIcon size={28} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4}>{channel.name}</Title>
              <Badge size="sm" variant="light" color={KIND_COLORS[channel.kind]}>
                {channel.kind}
              </Badge>
              <Switch
                size="sm"
                checked={channel.enabled}
                disabled={!canWrite}
                aria-label={`Toggle ${channel.name}`}
                onChange={(e) => {
                  void handleToggle(e.currentTarget.checked);
                }}
              />
            </Group>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Created {dayjs(channel.created_at).fromNow()}
            </Text>
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* Configuration (read-only) */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Configuration
        </Text>
        <ChannelKindConfigPanel
          kind={channel.kind}
          value={channel.config}
          onChange={() => {
            // read-only
          }}
          readOnly
        />
      </Stack>

      <Divider />

      {/* Test panel */}
      <TestPanel channelId={channel.id} channelName={channel.name} />

      <Divider />

      {/* Recent deliveries */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent deliveries ({String(recentDeliveries.length)})
        </Text>
        {recentDeliveries.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No deliveries have used this channel yet.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Attempts</Table.Th>
                <Table.Th>Notification</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recentDeliveries.map((d) => (
                <Table.Tr key={d.id}>
                  <Table.Td>
                    <Text size="xs">{dayjs(d.last_attempted_at).fromNow()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color={STATUS_COLOR[d.status] ?? 'gray'}>
                      {d.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {String(d.attempts)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
                      {d.notification_id}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <Divider />

      {/* Audit tail */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent activity
        </Text>
        {auditTail.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No audit entries for this channel yet.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Action</Table.Th>
                <Table.Th>Actor</Table.Th>
                <Table.Th>When</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {auditTail.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {e.action}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{e.actor_id}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{dayjs(e.at).format('MMM D, HH:mm:ss')}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" disabled={!canWrite} onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="subtle"
          color="red.8"
          disabled={!canWrite}
          leftSection={<IconBell size={14} />}
          onClick={openDelete}
        >
          Delete…
        </Button>
      </Group>

      {/* Delete modal — typed-name confirm */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete channel"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the channel. Routing rules that reference it will stop
            delivering until they are updated.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {channel.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={channel.name}
            data-autofocus
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                closeDelete();
                setDeleteInput('');
              }}
            >
              Cancel
            </Button>
            <Button
              color="red.8"
              size="sm"
              loading={deleting}
              disabled={deleteInput !== channel.name}
              onClick={() => void handleDelete()}
            >
              Delete permanently
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
