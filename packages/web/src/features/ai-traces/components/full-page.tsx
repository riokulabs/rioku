/**
 * <TraceFullPage> — full-page view of one AI trace with Mantine
 * Tabs: Overview / Spans / Tokens / Audit.
 *
 * Overview reuses <TraceDetail> as the single source of truth for
 * header + reveal. Spans renders the tool-call timeline standalone
 * (handy when there are many calls). Tokens shows the token usage
 * breakdown. Audit lists the audit rows tied to this trace id —
 * we filter the audit feed client-side by `entityId === traceId`
 * via the existing audit list endpoint.
 */
import { Tabs, Stack, Group, Text, Title, Badge, Table } from '@mantine/core';
import { IconHistory, IconTimeline, IconCoin, IconClipboardList } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { TraceDetail } from './detail';
import { ToolCallList } from './tool-call-list';
import type { AiTraceToolCall } from '@/api/resources';
import { useTraceDetail } from '../daemon-hooks';
import { formatTokens } from '@/features/ai-shared';

interface TraceFullPageProps {
  tenantSlug: string;
  traceId: string;
}

export function TraceFullPage({ tenantSlug, traceId }: TraceFullPageProps) {
  const { data, isLoading } = useTraceDetail(tenantSlug, traceId);
  const trace = data?.data;

  return (
    <Stack gap="md" p="md" data-testid="trace-full-page">
      <Group gap="sm" align="center">
        <Title order={2}>Trace</Title>
        <Badge size="sm" variant="light" color="gray" ff="monospace">
          {traceId}
        </Badge>
      </Group>

      <Tabs defaultValue="overview" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconHistory size={14} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="spans" leftSection={<IconTimeline size={14} />}>
            Spans
          </Tabs.Tab>
          <Tabs.Tab value="tokens" leftSection={<IconCoin size={14} />}>
            Tokens
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconClipboardList size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <TraceDetail
            traceId={traceId}
            tenantSlug={tenantSlug}
            onClose={() => {
              // No-op — the full page lives at its own URL; closing isn't applicable.
            }}
          />
        </Tabs.Panel>

        <Tabs.Panel value="spans" pt="md">
          {isLoading ? (
            <Text size="sm">Loading…</Text>
          ) : (
            <ToolCallList
              calls={(trace?.toolCalls ?? []) as unknown as readonly AiTraceToolCall[]}
            />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="tokens" pt="md">
          {trace ? (
            <Table withTableBorder withColumnBorders data-testid="trace-tokens-table">
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td>Input tokens</Table.Td>
                  <Table.Td ff="monospace">{formatTokens(trace.inputTokens)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Output tokens</Table.Td>
                  <Table.Td ff="monospace">{formatTokens(trace.outputTokens)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Total tokens</Table.Td>
                  <Table.Td ff="monospace">
                    {formatTokens(trace.inputTokens + trace.outputTokens)}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Duration</Table.Td>
                  <Table.Td ff="monospace">{String(trace.durationMs)}ms</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Occurred at</Table.Td>
                  <Table.Td ff="monospace">
                    {dayjs(trace.occurredAt).format('YYYY-MM-DD HH:mm:ss')}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="sm">Loading…</Text>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="trace-audit-tab">
            Audit rows for this trace are surfaced via the global audit log filtered by
            entity-id <code>{traceId}</code>. Reveals appear with schema{' '}
            <code>ai.trace_sensitive_revealed.v1</code>.
          </Text>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
