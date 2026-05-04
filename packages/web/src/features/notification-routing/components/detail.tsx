/**
 * <RoutingRuleDetail> — drawer content for a notification routing rule.
 *
 * Sections:
 *   - Header (name, event_filter badge, enabled Switch)
 *   - Channels (chips)
 *   - Recent matches (last 10 deliveries routed through this rule's channels
 *     — best-effort join via channel_ids since delivery log does not carry
 *     a rule_id today)
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
import { IconAlertCircle, IconRoute } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { deleteRoutingRule, updateRoutingRule, useRoutingRuleDetail } from '../api';

dayjs.extend(relativeTime);

const STATUS_COLOR: Record<string, string> = {
  delivered: 'green',
  retrying: 'yellow',
  failed: 'red',
  pending: 'gray',
};

interface RoutingRuleDetailProps {
  ruleId: string;
  onEdit: () => void;
  onClose: () => void;
}

export function RoutingRuleDetail({ ruleId, onEdit, onClose }: RoutingRuleDetailProps) {
  const rule = useRoutingRuleDetail(ruleId);
  const channels = useMockStore((s) => s.notificationChannels);
  const deliveryLog = useMockStore((s) => s.notificationDeliveryLog);
  const auditEntries = useMockStore((s) => s.audit);

  const canWrite = usePermission('notification-routing:write');

  const boundChannels = useMemo(() => {
    if (!rule) return [];
    return rule.channel_ids
      .map((cid) => channels[cid])
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
  }, [rule, channels]);

  const recentMatches = useMemo(() => {
    if (!rule) return [];
    const channelSet = new Set(rule.channel_ids);
    return Object.values(deliveryLog)
      .filter((d) => channelSet.has(d.channel_id))
      .slice()
      .sort((a, b) => b.last_attempted_at.localeCompare(a.last_attempted_at))
      .slice(0, 10);
  }, [rule, deliveryLog]);

  const auditTail = useMemo(() => {
    if (!rule) return [];
    return auditEntries
      .filter((e) => e.resource_type === 'notification-routing-rule' && e.resource_id === rule.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, rule]);

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!rule) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Routing rule not found.
      </Alert>
    );
  }

  // Capture the narrowed rule for closures that run after render.
  const definedRule = rule;

  async function handleToggle(enabled: boolean) {
    try {
      await updateRoutingRule(ruleId, { enabled });
    } catch {
      notify.error('Failed to update rule', 'Please try again.');
    }
  }

  async function handleDelete() {
    if (deleteInput !== definedRule.name) return;
    setDeleting(true);
    try {
      await deleteRoutingRule(ruleId);
      notify.success('Rule deleted', `${definedRule.name} was removed.`);
      closeDelete();
      onClose();
    } catch {
      notify.error('Failed to delete rule', 'Please try again.');
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
          <IconRoute size={28} color="var(--mantine-color-indigo-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4}>{rule.name}</Title>
              <Badge size="sm" variant="light" color="indigo" ff="monospace">
                {rule.event_filter}
              </Badge>
              <Switch
                size="sm"
                checked={rule.enabled}
                disabled={!canWrite}
                aria-label={`Toggle ${rule.name}`}
                onChange={(e) => {
                  void handleToggle(e.currentTarget.checked);
                }}
              />
            </Group>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Order hint: {String(rule.order_hint)} · created {dayjs(rule.created_at).fromNow()}
            </Text>
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* Channels */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Channels ({String(boundChannels.length)})
        </Text>
        {boundChannels.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No channels bound — this rule will not deliver anywhere.
          </Text>
        ) : (
          <Group gap={6}>
            {boundChannels.map((c) => (
              <Badge key={c.id} size="sm" variant="light" color="blue">
                {c.name} — {c.kind}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      <Divider />

      {/* Recent matches */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent deliveries via bound channels ({String(recentMatches.length)})
        </Text>
        {recentMatches.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No deliveries have touched this rule&apos;s channels yet.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>Channel</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Attempts</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recentMatches.map((d) => (
                <Table.Tr key={d.id}>
                  <Table.Td>
                    <Text size="xs">{dayjs(d.last_attempted_at).fromNow()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{channels[d.channel_id]?.name ?? d.channel_id}</Text>
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
            No audit entries for this rule yet.
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
        <Button size="sm" variant="subtle" color="red.8" disabled={!canWrite} onClick={openDelete}>
          Delete…
        </Button>
      </Group>

      {/* Delete modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete routing rule"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the rule. Notifications that matched its event filter will no
            longer be routed to its channels.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {rule.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={rule.name}
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
              disabled={deleteInput !== rule.name}
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
