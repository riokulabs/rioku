/**
 * <BindingFullPage> — dedicated route content for a single tool binding.
 *
 * Renders inside `/t/$tenant/ai/tool-bindings/$bindingId`. Mantine tabs:
 *   - Overview     — agent + tool refs, enabled toggle, created timestamp
 *   - CEL preview  — Monaco-backed editor + sample envelope JSON + Preview
 *                    button calling the daemon `preview-condition` endpoint
 *   - Bound tools  — every other tool the same agent is bound to (for
 *                    quick context — "what else can this agent do?")
 *   - Audit        — daemon-backed audit tail filtered to this binding
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconClock,
  IconEye,
  IconRouter,
  IconShieldCheck,
  IconTools,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useQuery } from '@tanstack/react-query';
import { configServiceGetAuditLog } from '@/api/generated/config-service/config-service';
import { ConditionEditor } from '@/components/condition-editor';
import { notify } from '@/hooks/use-notify';
import {
  previewCondition,
  updateBinding,
  useBindingDetailQuery,
  useBindingList,
  useInvalidateBindings,
} from '../api';
import { useAgentRefs, useToolRefs } from '../refs';
import type { BindingFilter, PreviewConditionResult } from '../types';

dayjs.extend(relativeTime);

interface BindingFullPageProps {
  tenantId: string;
  bindingId: string;
}

const EMPTY_FILTER: BindingFilter = { agent_ids: [], tool_ids: [] };

interface AuditRow {
  id: string;
  action: string;
  actor: string;
  at: string;
}

function useBindingAudit(tenantId: string, bindingId: string) {
  return useQuery({
    queryKey: ['ai-tool-routing', 'audit-fullpage', tenantId, bindingId],
    queryFn: async (): Promise<AuditRow[]> => {
      const res = await configServiceGetAuditLog({
        entityType: 'ai-tool-binding',
        entityId: bindingId,
        'page.pageSize': 50,
      });
      const body = res.data as unknown as {
        entries?: { id?: string; action?: string; actor?: string; createdAt?: string }[];
        items?: { id?: string; action?: string; actor?: string; createdAt?: string }[];
      };
      const list = body.entries ?? body.items ?? [];
      return list.map((e) => ({
        id: e.id ?? '',
        action: e.action ?? '',
        actor: e.actor ?? '',
        at: e.createdAt ?? '',
      }));
    },
    enabled: tenantId.length > 0 && bindingId.length > 0,
  });
}

const DEFAULT_SAMPLE_ENV = JSON.stringify(
  {
    request: {
      user: { role: 'admin', trusted: true },
      tenant: 'acme',
    },
    tool: { name: 'example-tool' },
    agent: { name: 'example-agent' },
  },
  null,
  2,
);

export function BindingFullPage({ tenantId, bindingId }: BindingFullPageProps) {
  const { data: binding, isLoading: bindingLoading } = useBindingDetailQuery(tenantId, bindingId);
  const { byId: agents } = useAgentRefs(tenantId);
  const { byId: tools } = useToolRefs(tenantId);
  const invalidate = useInvalidateBindings(tenantId);
  const auditQuery = useBindingAudit(tenantId, bindingId);

  // CEL preview tab state
  const [celDraft, setCelDraft] = useState<string>('');
  const [sampleEnv, setSampleEnv] = useState<string>(DEFAULT_SAMPLE_ENV);
  const [envParseError, setEnvParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewConditionResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Same-agent siblings list (for the "Bound tools" tab)
  const sameAgentBindings = useBindingList(
    tenantId,
    binding ? { agent_ids: [binding.agent_id], tool_ids: [] } : EMPTY_FILTER,
  );

  if (bindingLoading) {
    return <Loader size="sm" />;
  }
  if (!binding) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Binding not found.
      </Alert>
    );
  }

  const agent = agents[binding.agent_id];
  const tool = tools[binding.tool_id];

  // Initialise CEL editor draft when the binding loads.
  if (celDraft === '' && binding.condition !== '') {
    setCelDraft(binding.condition);
  }

  async function handleToggle(enabled: boolean) {
    try {
      await updateBinding(tenantId, bindingId, { enabled });
      invalidate();
    } catch {
      notify.error('Failed to update binding', 'Please try again.');
    }
  }

  async function handlePreview() {
    setEnvParseError(null);
    setPreview(null);
    setPreviewing(true);
    let envObj: Record<string, unknown>;
    try {
      envObj = JSON.parse(sampleEnv) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON';
      setEnvParseError(msg);
      setPreviewing(false);
      return;
    }
    try {
      const result = await previewCondition(tenantId, celDraft, envObj);
      setPreview(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Preview failed';
      setPreview({ parses: false, error: msg });
    } finally {
      setPreviewing(false);
    }
  }

  const auditRows = auditQuery.data ?? [];

  return (
    <Stack gap="md">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <IconRouter size={32} color="var(--mantine-color-indigo-6)" />
        <Stack gap={2} style={{ flex: 1 }}>
          <Title order={2}>Tool binding</Title>
          <Group gap="xs" wrap="nowrap">
            <Badge size="md" variant="light" color="blue" ff="monospace">
              {agent?.name ?? binding.agent_id}
            </Badge>
            <Text size="sm" c="var(--mantine-color-gray-7)">
              →
            </Text>
            <Badge size="md" variant="light" color="indigo" ff="monospace">
              {tool?.name ?? binding.tool_id}
            </Badge>
            <Switch
              size="sm"
              checked={binding.enabled}
              aria-label={`Toggle binding ${binding.id}`}
              onChange={(e) => {
                void handleToggle(e.currentTarget.checked);
              }}
            />
          </Group>
        </Stack>
      </Group>

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconRouter size={14} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="cel" leftSection={<IconEye size={14} />}>
            CEL preview
          </Tabs.Tab>
          <Tabs.Tab value="bound" leftSection={<IconTools size={14} />}>
            Bound tools
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconClock size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Stack gap="sm">
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Binding id:
              </Text>
              <Code>{binding.id}</Code>
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Agent:
              </Text>
              <Text size="sm" ff="monospace">
                {agent?.name ?? binding.agent_id}
              </Text>
              {agent?.model && (
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  ({agent.model})
                </Text>
              )}
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Tool:
              </Text>
              <Text size="sm" ff="monospace">
                {tool?.name ?? binding.tool_id}
              </Text>
              {tool?.kind && (
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  ({tool.kind})
                </Text>
              )}
            </Group>
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Created:
              </Text>
              <Text size="sm">
                {dayjs(binding.created_at).format('MMM D, YYYY HH:mm:ss')}{' '}
                <Text component="span" size="xs" c="var(--mantine-color-gray-7)">
                  ({dayjs(binding.created_at).fromNow()})
                </Text>
              </Text>
            </Group>
            <Divider />
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                CEL condition
              </Text>
              {binding.condition.trim() === '' ? (
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  (unconditional — always allow)
                </Text>
              ) : (
                <Code block>{binding.condition}</Code>
              )}
            </Stack>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="cel" pt="md">
          <Stack gap="md">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Edit a CEL expression and a sample event envelope, then click{' '}
              <Text component="span" fw={600}>
                Preview
              </Text>{' '}
              to evaluate it server-side using the same engine that runs at request-time. Saving
              here only previews — to persist, edit the binding from the list page or drawer.
            </Text>

            <ConditionEditor
              label="CEL expression"
              value={celDraft}
              onChange={(v) => {
                setCelDraft(v);
                setPreview(null);
              }}
              height={140}
            />

            <Stack gap="xs">
              <Text size="sm" fw={500}>
                Sample event JSON
              </Text>
              <Textarea
                value={sampleEnv}
                onChange={(e) => {
                  setSampleEnv(e.currentTarget.value);
                  setEnvParseError(null);
                }}
                minRows={8}
                maxRows={20}
                styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
                aria-label="Sample event JSON"
              />
              {envParseError && (
                <Text size="xs" c="var(--mantine-color-red-7)">
                  Invalid JSON: {envParseError}
                </Text>
              )}
            </Stack>

            <Group gap="sm">
              <Button
                leftSection={<IconEye size={14} />}
                loading={previewing}
                onClick={() => void handlePreview()}
              >
                Preview
              </Button>
              {preview && (
                <Box>
                  {preview.parses ? (
                    <Group gap="xs">
                      <IconShieldCheck size={16} color="var(--mantine-color-green-7)" />
                      <Text
                        size="sm"
                        c="var(--mantine-color-green-7)"
                        data-testid="cel-preview-result"
                      >
                        Matched: {preview.sample_result === true ? 'true' : 'false'}
                      </Text>
                    </Group>
                  ) : (
                    <Text size="sm" c="var(--mantine-color-red-7)" data-testid="cel-preview-error">
                      Error: {preview.error ?? 'unknown'}
                    </Text>
                  )}
                </Box>
              )}
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="bound" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Tools the agent{' '}
              <Text component="span" fw={600} ff="monospace">
                {agent?.name ?? binding.agent_id}
              </Text>{' '}
              is bound to.
            </Text>
            {sameAgentBindings.length === 0 ? (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                No other tools bound to this agent yet.
              </Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Tool</Table.Th>
                    <Table.Th>Condition</Table.Th>
                    <Table.Th>Enabled</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sameAgentBindings.map((b) => {
                    const t = tools[b.tool_id];
                    return (
                      <Table.Tr key={b.id}>
                        <Table.Td>
                          <Text size="sm" ff="monospace">
                            {t?.name ?? b.tool_id}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text
                            size="xs"
                            ff="monospace"
                            c="var(--mantine-color-gray-7)"
                            lineClamp={1}
                          >
                            {b.condition.trim() === '' ? '(unconditional)' : b.condition}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" color={b.enabled ? 'green' : 'gray'} variant="light">
                            {b.enabled ? 'on' : 'off'}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          {auditQuery.isLoading ? (
            <Loader size="sm" />
          ) : auditRows.length === 0 ? (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              No audit entries for this binding yet.
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
                {auditRows.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {e.action}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{e.actor}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{e.at ? dayjs(e.at).format('MMM D, HH:mm:ss') : '—'}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
