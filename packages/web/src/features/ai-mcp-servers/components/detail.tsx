/**
 * <McpServerDetail> — drawer content for an MCP server.
 *
 * Sections:
 *   - Identity (name, health chip, auth badge, enabled switch)
 *   - URL + credential prefix
 *   - Authorized agents (multi-select, live-editable)
 *   - Actions (Edit, Test connection, Delete — typed-name confirm)
 *   - Exposed tools (list) + cross-link to AI Tools page
 *   - Audit tail
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  MultiSelect,
  PasswordInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link } from '@tanstack/react-router';
import {
  IconAlertCircle,
  IconExternalLink,
  IconPlugConnected,
  IconRotate,
  IconServer,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { McpHealthChip } from '@/features/ai-shared';
import type { McpServer } from '@/api/resources';
import {
  deleteMcpServer,
  testMcpServer,
  updateMcpServer,
  useMcpServerDetail,
  useMcpServerTools,
} from '../api';
import type { TestMcpServerResult } from '../types';

dayjs.extend(relativeTime);

interface McpServerDetailProps {
  serverId: string;
  tenantSlug: string;
  onEdit: () => void;
  onClose: () => void;
}

const AUTH_COLORS: Record<McpServer['auth_kind'], string> = {
  none: 'gray',
  bearer: 'blue',
  'api-key': 'violet',
};

export function McpServerDetail({ serverId, tenantSlug, onEdit, onClose }: McpServerDetailProps) {
  const server = useMcpServerDetail(serverId);
  const exposedTools = useMcpServerTools(serverId);
  const auditEntries = useMockStore((s) => s.audit);
  const agents = useMockStore((s) => s.aiAgents);

  const auditTail = useMemo(() => {
    if (!server) return [];
    return auditEntries
      .filter((e) => e.resource_type === 'mcp-server' && e.resource_id === server.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, server]);

  const agentOptions = useMemo(() => {
    if (!server) return [];
    return Object.values(agents)
      .filter((a) => a.tenant_id === server.tenant_id)
      .map((a) => ({ value: a.id, label: a.name }));
  }, [agents, server]);

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [rotateOpened, { open: openRotate, close: closeRotate }] = useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestMcpServerResult | null>(null);
  const [rotateValue, setRotateValue] = useState('');
  const [rotating, setRotating] = useState(false);
  const [savingAgents, setSavingAgents] = useState(false);

  if (!server) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        MCP server not found.
      </Alert>
    );
  }

  async function handleToggle(enabled: boolean) {
    if (!server) return;
    try {
      await updateMcpServer(server.id, { enabled });
    } catch {
      notify.error('Failed to update server', 'Please try again.');
    }
  }

  async function handleTest() {
    if (!server) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testMcpServer(server.id);
      setTestResult(result);
      if (result.ok) {
        notify.success(
          'Connection OK',
          `${server.name} returned ${String(result.tool_count)} tools in ${String(result.latency_ms)}ms.`,
        );
      } else {
        notify.error('Connection failed', result.error_message ?? 'Upstream error');
      }
    } catch {
      notify.error('Failed to test server', 'Please try again.');
    } finally {
      setTesting(false);
    }
  }

  async function handleRotate() {
    if (!server) return;
    if (rotateValue === '') return;
    setRotating(true);
    try {
      await updateMcpServer(server.id, { auth_credential: rotateValue });
      notify.success('Credential rotated', `${server.name} credential updated.`);
      closeRotate();
      setRotateValue('');
    } catch {
      notify.error('Failed to rotate credential', 'Please try again.');
    } finally {
      setRotating(false);
    }
  }

  async function handleAgentsChange(next: string[]) {
    if (!server) return;
    setSavingAgents(true);
    try {
      await updateMcpServer(server.id, { authorized_agent_ids: next });
    } catch {
      notify.error('Failed to update authorized agents', 'Please try again.');
    } finally {
      setSavingAgents(false);
    }
  }

  async function handleDelete() {
    if (!server) return;
    if (deleteInput !== server.name) return;
    setDeleting(true);
    try {
      await deleteMcpServer(server.id);
      notify.success('MCP server deleted', `${server.name} was removed.`);
      closeDelete();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete server';
      notify.error('Cannot delete', msg);
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
          <IconServer size={28} color="var(--mantine-color-violet-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4} ff="monospace">
                {server.name}
              </Title>
              <McpHealthChip health={server.health} />
              <Badge size="sm" variant="light" color={AUTH_COLORS[server.auth_kind]}>
                {server.auth_kind}
              </Badge>
              <Switch
                size="sm"
                checked={server.enabled}
                aria-label={`Toggle ${server.name}`}
                onChange={(e) => {
                  void handleToggle(e.currentTarget.checked);
                }}
              />
            </Group>
            {server.description && (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {server.description}
              </Text>
            )}
            {server.last_seen_at && (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Last seen {dayjs(server.last_seen_at).fromNow()}
              </Text>
            )}
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* URL + credential */}
      <Stack gap="xs">
        <Group gap="xs">
          <Text size="sm" fw={600}>
            URL
          </Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {server.url}
          </Text>
        </Group>
        {server.auth_credential_ref && (
          <Group gap="xs" align="center">
            <Text size="sm" fw={600}>
              Credential
            </Text>
            <Badge size="sm" variant="outline" color="gray" ff="monospace">
              {server.auth_credential_ref.prefix}…
            </Badge>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              created {dayjs(server.auth_credential_ref.created_at).fromNow()}
            </Text>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconRotate size={14} />}
              onClick={openRotate}
            >
              Rotate
            </Button>
          </Group>
        )}
      </Stack>

      <Divider />

      {/* Authorized agents */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Authorized agents
        </Text>
        <MultiSelect
          description="Agents that may route tool calls through this server. Empty = all."
          placeholder={server.authorized_agent_ids.length === 0 ? 'All agents' : undefined}
          data={agentOptions}
          value={server.authorized_agent_ids}
          onChange={(next) => {
            void handleAgentsChange(next);
          }}
          disabled={savingAgents}
          searchable
          clearable
        />
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="light"
          leftSection={<IconPlugConnected size={14} />}
          loading={testing}
          onClick={() => void handleTest()}
        >
          Test connection
        </Button>
        <Button size="sm" variant="subtle" color="red.8" onClick={openDelete}>
          Delete…
        </Button>
        {testResult && (
          <Badge size="sm" color={testResult.ok ? 'green' : 'red'} variant="light">
            {testResult.ok ? 'OK' : 'FAIL'} · {String(testResult.latency_ms)}ms ·{' '}
            {String(testResult.tool_count)} tools
          </Badge>
        )}
      </Group>

      <Divider />

      {/* Exposed tools + cross-link */}
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            Exposed tools ({String(exposedTools.length)})
          </Text>
          <Button
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
            component={Link as any}
            to="/t/$tenant/ai/tools"
            params={{ tenant: tenantSlug }}
            search={{ mcp_server_id: server.id }}
            size="xs"
            variant="subtle"
            rightSection={<IconExternalLink size={12} />}
          >
            View all tools exposed by this server
          </Button>
        </Group>
        {exposedTools.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No tools exposed yet. Test the connection to discover tools.
          </Text>
        ) : (
          <Group gap={6}>
            {exposedTools.map((t) => (
              <Badge key={t.id} size="xs" variant="light" color="indigo">
                {t.name}
              </Badge>
            ))}
          </Group>
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
            No audit entries for this server yet.
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

      {/* Rotate modal */}
      <Modal
        opened={rotateOpened}
        onClose={() => {
          closeRotate();
          setRotateValue('');
        }}
        title="Rotate credential"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">Paste the new credential. Only the prefix will be stored.</Text>
          <PasswordInput
            value={rotateValue}
            onChange={(e) => {
              setRotateValue(e.currentTarget.value);
            }}
            data-autofocus
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                closeRotate();
                setRotateValue('');
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={rotating}
              disabled={rotateValue === ''}
              onClick={() => void handleRotate()}
            >
              Rotate
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete MCP server"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently removes the server. Tools referencing it must be unbound first.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {server.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={server.name}
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
              disabled={deleteInput !== server.name}
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
