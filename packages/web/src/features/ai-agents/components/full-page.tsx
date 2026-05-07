/**
 * <AgentFullPage> — 4-tab agent view rendered on /t/$tenant/ai/agents/$agentId.
 *
 * Tabs:
 *   - Profile  : header, system prompt, guardrails, rotate-credential, edit/delete
 *   - Tools    : list of bound tools (daemon `/tools` endpoint)
 *   - Traces   : recent invocation traces (daemon `/traces` endpoint)
 *   - Audit    : audit-log entries scoped to this agent (real audit feed)
 *
 * The Profile tab embeds the InvokePanel for streaming SSE invokes.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Modal,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconHistory,
  IconRobot,
  IconRotate,
  IconShieldCheck,
  IconTimeline,
  IconTool,
  IconUser,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useAuditList } from '@/features/audit/api';
import type { AuditFilter } from '@/features/audit/types';
import { notify } from '@/hooks/use-notify';

const AGENT_AUDIT_FILTER: AuditFilter = {
  actions: [],
  outcomes: [],
  resource_types: ['ai-agent'],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  resource_id_handles: [],
  search: '',
};
import { formatCost, formatTokens } from '@/features/ai-shared';
import {
  deleteAgent,
  rotateScopedCredential,
  updateAgent,
  useAgentDetail,
  useAgentTools,
  useAgentTraces,
} from '../api';
import type { RotateAgentCredentialResult } from '../api';
import { InvokePanel } from './invoke-panel';

dayjs.extend(relativeTime);

interface AgentFullPageProps {
  tenant: string;
  agentId: string;
  onDeleted?: () => void;
  onEdit?: () => void;
}

export function AgentFullPage({ tenant, agentId, onDeleted, onEdit }: AgentFullPageProps) {
  const agent = useAgentDetail(tenant, agentId);
  const tools = useAgentTools(tenant, agentId);
  const traces = useAgentTraces(tenant, agentId, 50);
  const auditEntries = useAuditList(tenant, AGENT_AUDIT_FILTER);

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [rotateOpened, { open: openRotate, close: closeRotate }] = useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotated, setRotated] = useState<RotateAgentCredentialResult | null>(null);

  const auditTail = useMemo(() => {
    if (!agent) return [];
    return auditEntries
      .filter((e) => e.resource_type === 'ai-agent' && e.resource_id === agent.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 30);
  }, [auditEntries, agent]);

  if (!agent) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Agent not found or inaccessible.
      </Alert>
    );
  }

  async function handleToggle(enabled: boolean) {
    if (!agent) return;
    try {
      await updateAgent(tenant, agent.id, { enabled });
    } catch {
      notify.error('Failed to update agent', 'Please try again.');
    }
  }

  async function handleDelete() {
    if (!agent) return;
    if (deleteInput !== agent.name) return;
    setDeleting(true);
    try {
      await deleteAgent(tenant, agent.id);
      notify.success('Agent deleted', `${agent.name} was removed.`);
      closeDelete();
      onDeleted?.();
    } catch {
      notify.error('Failed to delete agent', 'Please try again.');
    } finally {
      setDeleting(false);
      setDeleteInput('');
    }
  }

  async function handleRotate() {
    if (!agent) return;
    setRotating(true);
    try {
      const result = await rotateScopedCredential(tenant, agent.id);
      setRotated(result);
    } catch {
      notify.error('Failed to rotate credential', 'Please try again.');
    } finally {
      setRotating(false);
    }
  }

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconRobot size={32} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={2} ff="monospace">
                {agent.name}
              </Title>
              <Badge size="md" variant="outline" color="blue" ff="monospace">
                {agent.model}
              </Badge>
              <Switch
                size="sm"
                checked={agent.enabled}
                aria-label={`Toggle ${agent.name}`}
                onChange={(e) => {
                  void handleToggle(e.currentTarget.checked);
                }}
              />
            </Group>
            {agent.description && (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {agent.description}
              </Text>
            )}
          </Stack>
        </Group>
        <Group gap="sm">
          {onEdit && (
            <Button size="sm" onClick={onEdit}>
              Edit
            </Button>
          )}
          <Button size="sm" variant="subtle" color="red" onClick={openDelete}>
            Delete…
          </Button>
        </Group>
      </Group>

      <Tabs defaultValue="profile" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="profile" leftSection={<IconUser size={14} />}>
            Profile
          </Tabs.Tab>
          <Tabs.Tab value="tools" leftSection={<IconTool size={14} />}>
            Tools ({String(tools.length)})
          </Tabs.Tab>
          <Tabs.Tab value="traces" leftSection={<IconTimeline size={14} />}>
            Traces ({String(traces.length)})
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        {/* Profile */}
        <Tabs.Panel value="profile" pt="md">
          <Stack gap="md">
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                System prompt
              </Text>
              <Code block>{agent.system_prompt}</Code>
            </Stack>

            <Divider />

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Guardrails
              </Text>
              <Group gap="md">
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  max_tokens: {String(agent.max_tokens_per_request)}
                </Text>
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  temperature: {agent.temperature.toFixed(2)}
                </Text>
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  stop:{' '}
                  {agent.stop_sequences.length === 0
                    ? 'none'
                    : agent.stop_sequences.join(', ')}
                </Text>
              </Group>
            </Stack>

            <Divider />

            <Stack gap="xs">
              <Group gap="xs" align="center">
                <IconShieldCheck size={16} />
                <Text size="sm" fw={600}>
                  Scoped credential
                </Text>
              </Group>
              {agent.scoped_credential_ref ? (
                <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
                  prefix: {agent.scoped_credential_ref.prefix} · created:{' '}
                  {dayjs(agent.scoped_credential_ref.created_at).fromNow()}
                </Text>
              ) : (
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  Inherits the provider credential.
                </Text>
              )}
              <Group>
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconRotate size={14} />}
                  onClick={openRotate}
                >
                  Rotate credential
                </Button>
              </Group>
            </Stack>

            <Divider />

            <InvokePanel tenant={tenant} agentId={agent.id} />
          </Stack>
        </Tabs.Panel>

        {/* Tools */}
        <Tabs.Panel value="tools" pt="md">
          {tools.length === 0 ? (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              No tools bound to this agent.
            </Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tool ID</Table.Th>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th>Enabled</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tools.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {t.id}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color="indigo">
                        {t.kind}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={t.enabled ? 'green' : 'gray'}>
                        {t.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Tabs.Panel>

        {/* Traces */}
        <Tabs.Panel value="traces" pt="md">
          {traces.length === 0 ? (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              No traces recorded yet for this agent.
            </Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Tokens</Table.Th>
                  <Table.Th>Latency</Table.Th>
                  <Table.Th>Cost</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {traces.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td>
                      <Text size="xs">{t.at ? dayjs(t.at).fromNow() : '-'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        variant="light"
                        color={
                          t.status === 'success'
                            ? 'green'
                            : t.status === 'timeout'
                              ? 'yellow'
                              : 'red'
                        }
                      >
                        {t.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{formatTokens(t.input_tokens + t.output_tokens)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{String(t.latency_ms)}ms</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{formatCost(t.cost_usd)}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Tabs.Panel>

        {/* Audit */}
        <Tabs.Panel value="audit" pt="md">
          {auditTail.length === 0 ? (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              No audit entries for this agent yet.
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
        </Tabs.Panel>
      </Tabs>

      {/* Rotate modal */}
      <Modal
        opened={rotateOpened}
        onClose={() => {
          closeRotate();
          setRotated(null);
        }}
        title="Rotate scoped credential"
        size="sm"
      >
        <Stack gap="md">
          {rotated === null && (
            <>
              <Alert color="yellow" variant="light" icon={<IconAlertCircle size={16} />}>
                Rotating issues a new credential. The previous one is invalidated
                immediately. The new value is shown only once.
              </Alert>
              <Group justify="flex-end" gap="sm">
                <Button variant="default" size="sm" onClick={closeRotate}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={rotating}
                  onClick={() => void handleRotate()}
                  data-testid="rotate-confirm"
                >
                  Rotate now
                </Button>
              </Group>
            </>
          )}
          {rotated !== null && (
            <>
              <Alert color="green" variant="light">
                Credential rotated. Copy the value below — it cannot be shown again.
              </Alert>
              <Code block data-testid="rotated-credential">
                {rotated.newCredential}
              </Code>
              <Group justify="flex-end" gap="sm">
                <Button
                  size="sm"
                  onClick={() => {
                    closeRotate();
                    setRotated(null);
                  }}
                >
                  Close
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>

      {/* Delete modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete agent"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the agent and all of its tool bindings.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {agent.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={agent.name}
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
              disabled={deleteInput !== agent.name}
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
