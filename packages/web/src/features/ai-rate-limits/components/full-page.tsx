/**
 * <RateLimitFullPage> — full-page tabbed editor for an AI semantic
 * rate-limit rule.
 *
 * Tabs:
 *   - Configuration  Read-only summary of name/scope/threshold/window/
 *                    max-matches/exemplars/action/enabled. Sufficient
 *                    until the form is moved here in a follow-up.
 *   - Simulate       Probe-style simulator (request_count + window +
 *                    principal). Calls POST `/ai/rate-limits/{id}/simulate`.
 *   - Metrics        Throttle-event LineChart over the last 24h. Calls
 *                    GET `/ai/rate-limits/{id}/metrics?since=24h`.
 *   - Audit          Read-only list of audit entries scoped to this rule.
 *
 * The "Open full page" link in the drawer routes here, mirroring the
 * pattern Plan 03 established for middlewares/services/routes.
 */
import { useMemo } from 'react';
import { Alert, Badge, Group, Stack, Tabs, Table, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconGauge } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { AuditList, useAuditList, encodeResourceHandle } from '@/features/audit';
import type { AuditFilter } from '@/features/audit';
import type { AuditEntry, AiSemanticRateLimit } from '@/api/resources';
import { useRateLimitDetail } from '../api';
import { Simulator } from './simulator';
import { RateLimitMetricsChart } from './metrics-chart';

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

const EMPTY_AUDIT_FILTER_BASE: Omit<AuditFilter, 'resource_id_handles' | 'resource_types'> = {
  actions: [],
  outcomes: [],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  search: '',
};

export interface RateLimitFullPageProps {
  ruleId: string;
  tenantId: string;
}

export function RateLimitFullPage({ ruleId, tenantId }: RateLimitFullPageProps) {
  const rule = useRateLimitDetail(tenantId, ruleId);
  const agents = useMockStore((s) => s.aiAgents);
  const tools = useMockStore((s) => s.aiTools);

  const auditFilter: AuditFilter = useMemo(
    () => ({
      ...EMPTY_AUDIT_FILTER_BASE,
      resource_types: ['ai-rate-limit'],
      resource_id_handles: [encodeResourceHandle('ai-rate-limit', ruleId)],
    }),
    [ruleId],
  );
  const auditEntries = useAuditList(tenantId, auditFilter);

  if (!rule) {
    return (
      <Stack gap="md" p="md">
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          Rate limit not found.
        </Alert>
      </Stack>
    );
  }

  const target =
    rule.scope === 'agent' && rule.agent_id
      ? agents[rule.agent_id]?.name
      : rule.scope === 'tool' && rule.tool_id
        ? tools[rule.tool_id]?.name
        : undefined;

  return (
    <Stack gap="md" p="md" data-testid="rate-limit-full-page">
      <Group gap="sm" align="center">
        <IconGauge size={26} color="var(--mantine-color-teal-6)" />
        <Title order={2} ff="monospace">
          {rule.name}
        </Title>
        <Badge size="md" variant="outline" color="gray">
          {rule.scope}
        </Badge>
        <Badge size="md" variant="light" color={ACTION_COLORS[rule.action]}>
          {rule.action}
        </Badge>
        <Badge size="md" variant="light" color={rule.enabled ? 'green' : 'gray'}>
          {rule.enabled ? 'enabled' : 'disabled'}
        </Badge>
      </Group>

      <Tabs defaultValue="config" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="config" data-testid="rate-limit-tab-config">
            Configuration
          </Tabs.Tab>
          <Tabs.Tab value="simulate" data-testid="rate-limit-tab-simulate">
            Simulate
          </Tabs.Tab>
          <Tabs.Tab value="metrics" data-testid="rate-limit-tab-metrics">
            Metrics
          </Tabs.Tab>
          <Tabs.Tab value="audit" data-testid="rate-limit-tab-audit">
            Audit
          </Tabs.Tab>
        </Tabs.List>

        {/* Configuration */}
        <Tabs.Panel value="config" pt="md">
          <Stack gap="sm" data-testid="rate-limit-config-panel">
            {rule.description && (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {rule.description}
              </Text>
            )}
            <Table withTableBorder withColumnBorders striped>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Td>{rule.name}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Scope</Table.Th>
                  <Table.Td>{rule.scope}</Table.Td>
                </Table.Tr>
                {target !== undefined && (
                  <Table.Tr>
                    <Table.Th>Target</Table.Th>
                    <Table.Td>{target}</Table.Td>
                  </Table.Tr>
                )}
                <Table.Tr>
                  <Table.Th>Similarity threshold</Table.Th>
                  <Table.Td>{rule.similarity_threshold.toFixed(3)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Window</Table.Th>
                  <Table.Td>{formatWindow(rule.window_seconds)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Max matches</Table.Th>
                  <Table.Td>{String(rule.max_matches)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Action</Table.Th>
                  <Table.Td>{rule.action}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Exemplars</Table.Th>
                  <Table.Td>
                    {rule.exemplars.length === 0
                      ? '—'
                      : rule.exemplars.join(', ')}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Enabled</Table.Th>
                  <Table.Td>{String(rule.enabled)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Created</Table.Th>
                  <Table.Td>{rule.created_at}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Stack>
        </Tabs.Panel>

        {/* Simulate */}
        <Tabs.Panel value="simulate" pt="md">
          <Stack gap="sm" data-testid="rate-limit-simulate-panel">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Probe a request volume against this rule. The daemon answers
              would_throttle, retry_after_ms, current_consumption and limit.
            </Text>
            <Simulator tenantId={tenantId} ruleId={rule.id} />
          </Stack>
        </Tabs.Panel>

        {/* Metrics */}
        <Tabs.Panel value="metrics" pt="md">
          <Stack gap="sm" data-testid="rate-limit-metrics-panel">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Throttle events per hour over the last 24 hours.
            </Text>
            <RateLimitMetricsChart tenantId={tenantId} ruleId={rule.id} window="24h" />
          </Stack>
        </Tabs.Panel>

        {/* Audit */}
        <Tabs.Panel value="audit" pt="md">
          <Stack gap="sm" data-testid="rate-limit-audit-panel">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Audit entries scoped to this rule.
            </Text>
            <AuditList rows={auditEntries} onSelect={(_e: AuditEntry) => undefined} />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
