/**
 * <RateLimitDetail> — drawer content for a semantic rate-limit rule.
 *
 * Sections:
 *   - Identity header (name, scope chip, action badge, enabled switch, close)
 *   - Threshold/window/max fields
 *   - Exemplars chip group
 *   - Full-width metrics sparkline (24h window)
 *   - Simulator
 *   - Actions (Edit, Delete — typed-name confirm)
 *   - Audit tail
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Chip,
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
import { IconAlertCircle, IconGauge } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useAgentList } from '@/features/ai-agents/api';
import type { AgentFilter } from '@/features/ai-agents/types';
import { useToolList } from '@/features/ai-tools/api';
import type { ToolFilter } from '@/features/ai-tools/types';
import { useAuditList } from '@/features/audit/api';
import type { AuditFilter } from '@/features/audit/types';
import { notify } from '@/hooks/use-notify';
import type { AiSemanticRateLimit } from '@/api/resources';
import { deleteRateLimit, updateRateLimit, useRateLimitDetail } from '../api';

const EMPTY_AGENT_FILTER: AgentFilter = { search: '', provider_ids: [], role_ids: [] };
const EMPTY_TOOL_FILTER: ToolFilter = { search: '', kinds: [] };
const RATE_LIMIT_AUDIT_FILTER: AuditFilter = {
  actions: [],
  outcomes: [],
  resource_types: ['ai-rate-limit'],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  resource_id_handles: [],
  search: '',
};
import { MetricsSparkline } from './metrics-sparkline';
import { Simulator } from './simulator';

dayjs.extend(relativeTime);

interface RateLimitDetailProps {
  tenantId: string;
  ruleId: string;
  onEdit: () => void;
  onClose: () => void;
}

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

export function RateLimitDetail({ tenantId, ruleId, onEdit, onClose }: RateLimitDetailProps) {
  const rule = useRateLimitDetail(tenantId, ruleId);
  const agentList = useAgentList(tenantId, EMPTY_AGENT_FILTER);
  const toolList = useToolList(tenantId, EMPTY_TOOL_FILTER);
  const agents = useMemo(() => {
    const m: Record<string, (typeof agentList)[number]> = {};
    for (const a of agentList) m[a.id] = a;
    return m;
  }, [agentList]);
  const tools = useMemo(() => {
    const m: Record<string, (typeof toolList)[number]> = {};
    for (const t of toolList) m[t.id] = t;
    return m;
  }, [toolList]);
  const auditEntries = useAuditList(tenantId, RATE_LIMIT_AUDIT_FILTER);

  const auditTail = useMemo(() => {
    if (!rule) return [];
    return auditEntries
      .filter((e) => e.resource_id === rule.id)
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
        Rate limit not found.
      </Alert>
    );
  }

  const target =
    rule.scope === 'agent' && rule.agent_id
      ? agents[rule.agent_id]?.name
      : rule.scope === 'tool' && rule.tool_id
        ? tools[rule.tool_id]?.name
        : undefined;

  async function handleToggle(enabled: boolean) {
    if (!rule) return;
    try {
      await updateRateLimit(tenantId, rule.id, { enabled });
    } catch {
      notify.error('Failed to update rule', 'Please try again.');
    }
  }

  async function handleDelete() {
    if (!rule) return;
    if (deleteInput !== rule.name) return;
    setDeleting(true);
    try {
      await deleteRateLimit(tenantId, rule.id);
      notify.success('Rate limit deleted', `${rule.name} was removed.`);
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
          <IconGauge size={28} color="var(--mantine-color-teal-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4} ff="monospace">
                {rule.name}
              </Title>
              <Badge size="sm" variant="outline" color="gray">
                {rule.scope}
              </Badge>
              <Badge size="sm" variant="light" color={ACTION_COLORS[rule.action]}>
                {rule.action}
              </Badge>
              <Switch
                size="sm"
                checked={rule.enabled}
                aria-label={`Toggle ${rule.name}`}
                onChange={(e) => {
                  void handleToggle(e.currentTarget.checked);
                }}
              />
            </Group>
            {rule.description && (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {rule.description}
              </Text>
            )}
            {target && (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Target: {target}
              </Text>
            )}
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* Config */}
      <Stack gap="xs">
        <Group gap="md">
          <Text size="sm" fw={600}>
            Threshold
          </Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {rule.similarity_threshold.toFixed(3)}
          </Text>
          <Text size="sm" fw={600}>
            Window
          </Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {formatWindow(rule.window_seconds)}
          </Text>
          <Text size="sm" fw={600}>
            Max matches
          </Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {String(rule.max_matches)}
          </Text>
        </Group>
      </Stack>

      {/* Exemplars */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Exemplars ({String(rule.exemplars.length)})
        </Text>
        {rule.exemplars.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No exemplars defined.
          </Text>
        ) : (
          <Chip.Group multiple value={[]} onChange={() => undefined}>
            <Group gap={6}>
              {rule.exemplars.map((ex, idx) => (
                <Chip key={`${ex}-${String(idx)}`} value={ex} size="xs" variant="outline">
                  {ex}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        )}
      </Stack>

      <Divider />

      {/* Metrics */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Matches — last 24h
        </Text>
        <MetricsSparkline tenantId={tenantId} ruleId={rule.id} size="lg" window="24h" />
      </Stack>

      <Divider />

      {/* Simulator */}
      <Simulator tenantId={tenantId} ruleId={rule.id} />

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="subtle" color="red.8" onClick={openDelete}>
          Delete…
        </Button>
      </Group>

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

      {/* Delete modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete rate limit"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the rule. Matches in-flight at delete time will not be retried.
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
