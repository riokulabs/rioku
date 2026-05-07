/**
 * <AgentDetail> — drawer content for an AI agent.
 *
 * Sections:
 *   - Identity (name, provider/kind, model, enabled switch)
 *   - System prompt (read-only Code block, collapsible)
 *   - Tools (chips)
 *   - Role bindings (chips)
 *   - Guardrails (max_tokens, temperature, stop_sequences)
 *   - InvokePanel
 *   - Recent traces (last 10)
 *   - Actions (Edit, Rotate credential, Delete — typed-name confirm)
 *   - Audit tail
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Collapse,
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
import { Link } from '@tanstack/react-router';
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconRobot,
  IconRotate,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useProviderList } from '@/features/ai-providers/api';
import type { ProviderFilter } from '@/features/ai-providers/types';
import { useRolesMap } from '@/features/security/roles/api';
import { useAuditList } from '@/features/audit/api';
import type { AuditFilter } from '@/features/audit/types';
import { notify } from '@/hooks/use-notify';
import { ProviderKindBadge, formatCost, formatTokens, shortenPrompt } from '@/features/ai-shared';

const EMPTY_PROVIDER_FILTER: ProviderFilter = { search: '', kinds: [] };
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

interface AgentDetailProps {
  agentId: string;
  tenantSlug: string;
  onEdit: () => void;
  onClose: () => void;
}

export function AgentDetail({ agentId, tenantSlug, onEdit, onClose }: AgentDetailProps) {
  const agent = useAgentDetail(tenantSlug, agentId);
  const tools = useAgentTools(tenantSlug, agentId);
  const recentTraces = useAgentTraces(tenantSlug, agentId, 10);
  const auditEntries = useAuditList(tenantSlug, AGENT_AUDIT_FILTER);
  const providerList = useProviderList(tenantSlug, EMPTY_PROVIDER_FILTER);
  const providers = useMemo(() => {
    const m: Record<string, (typeof providerList)[number]> = {};
    for (const p of providerList) m[p.id] = p;
    return m;
  }, [providerList]);
  const roles = useRolesMap(tenantSlug);

  const provider = agent ? providers[agent.provider_id] : undefined;

  const auditTail = useMemo(() => {
    if (!agent) return [];
    return auditEntries
      .filter((e) => e.resource_id === agent.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, agent]);

  const [promptOpened, { toggle: togglePrompt }] = useDisclosure(false);
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [rotateOpened, { open: openRotate, close: closeRotate }] = useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotatedCredential, setRotatedCredential] = useState<RotateAgentCredentialResult | null>(
    null,
  );

  if (!agent) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Agent not found.
      </Alert>
    );
  }

  async function handleToggle(enabled: boolean) {
    if (!agent) return;
    try {
      await updateAgent(tenantSlug, agent.id, { enabled });
    } catch {
      notify.error('Failed to update agent', 'Please try again.');
    }
  }

  async function handleDelete() {
    if (!agent) return;
    if (deleteInput !== agent.name) return;
    setDeleting(true);
    try {
      await deleteAgent(tenantSlug, agent.id);
      notify.success('Agent deleted', `${agent.name} was removed.`);
      closeDelete();
      onClose();
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
      const result = await rotateScopedCredential(tenantSlug, agent.id);
      setRotatedCredential(result);
      notify.success('Credential rotated', `${agent.name} credential updated.`);
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
          <IconRobot size={28} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4} ff="monospace">
                {agent.name}
              </Title>
              {provider && <ProviderKindBadge kind={provider.kind} />}
              <Badge size="sm" variant="outline" color="blue" ff="monospace">
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
            {provider && (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Provider: {provider.name}
              </Text>
            )}
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* System prompt */}
      <Stack gap="xs">
        <Button
          variant="subtle"
          size="xs"
          leftSection={
            promptOpened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />
          }
          onClick={togglePrompt}
          style={{ alignSelf: 'flex-start' }}
          type="button"
        >
          System prompt ({String(agent.system_prompt.length)} chars)
        </Button>
        <Collapse expanded={promptOpened}>
          <Code block>{agent.system_prompt}</Code>
        </Collapse>
      </Stack>

      <Divider />

      {/* Tools */}
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            Tools ({String(tools.length)})
          </Text>
          <Button
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
            component={Link as any}
            to="/t/$tenant/ai/tool-routing"
            params={{ tenant: tenantSlug }}
            search={{ agent: agent.id }}
            size="xs"
            variant="subtle"
            rightSection={<IconExternalLink size={12} />}
          >
            View all bindings for this agent
          </Button>
        </Group>
        {tools.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No tools bound to this agent.
          </Text>
        ) : (
          <Group gap={6}>
            {tools.map((t) => (
              <Badge key={t.id} size="xs" variant="light" color="indigo">
                {t.name} · {t.kind}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      {/* Role bindings */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Roles ({String(agent.role_ids.length)})
        </Text>
        {agent.role_ids.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Any role can invoke this agent.
          </Text>
        ) : (
          <Group gap={6}>
            {agent.role_ids.map((rid) => {
              const r = roles[rid];
              return (
                <Badge key={rid} size="xs" variant="light" color="violet">
                  {r?.name ?? rid}
                </Badge>
              );
            })}
          </Group>
        )}
      </Stack>

      <Divider />

      {/* Guardrails */}
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
            stop: {agent.stop_sequences.length === 0 ? 'none' : agent.stop_sequences.join(', ')}
          </Text>
        </Group>
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="subtle"
          leftSection={<IconRotate size={14} />}
          onClick={openRotate}
        >
          Rotate credential
        </Button>
        <Button size="sm" variant="subtle" color="red.8" onClick={openDelete}>
          Delete…
        </Button>
      </Group>

      <Divider />

      {/* Invoke panel */}
      <InvokePanel tenant={tenantSlug} agentId={agent.id} />

      <Divider />

      {/* Recent traces */}
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            Recent traces ({String(recentTraces.length)})
          </Text>
          <Button
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
            component={Link as any}
            to="/t/$tenant/ai/traces"
            params={{ tenant: tenantSlug }}
            search={{ agent: agent.id, range: '24h' }}
            size="xs"
            variant="subtle"
            rightSection={<IconExternalLink size={12} />}
          >
            View all traces for this agent
          </Button>
        </Group>
        {recentTraces.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No traces recorded yet.
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
                <Table.Th>Prompt</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recentTraces.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>
                    <Text size="xs">{dayjs(t.at).fromNow()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        t.status === 'success' ? 'green' : t.status === 'timeout' ? 'yellow' : 'red'
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
                  <Table.Td>
                    <Text
                      size="xs"
                      ff="monospace"
                      c="var(--mantine-color-gray-7)"
                      title={t.prompt_text}
                    >
                      {shortenPrompt(t.prompt_text, 60)}
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
      </Stack>

      {/* Rotate credential modal */}
      <Modal
        opened={rotateOpened}
        onClose={() => {
          closeRotate();
          setRotatedCredential(null);
        }}
        title="Rotate scoped credential"
        size="sm"
      >
        <Stack gap="md">
          {rotatedCredential === null && (
            <>
              <Alert color="yellow" variant="light" icon={<IconAlertCircle size={16} />}>
                Rotating will issue a new credential. The previous one is invalidated
                immediately. The new credential is shown only once.
              </Alert>
              <Group justify="flex-end" gap="sm">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    closeRotate();
                  }}
                >
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
          {rotatedCredential !== null && (
            <>
              <Alert color="green" variant="light">
                Credential rotated successfully. Copy the value below — it cannot be
                shown again.
              </Alert>
              <Code block data-testid="rotated-credential">
                {rotatedCredential.newCredential}
              </Code>
              <Group justify="flex-end" gap="sm">
                <Button
                  size="sm"
                  onClick={() => {
                    closeRotate();
                    setRotatedCredential(null);
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
