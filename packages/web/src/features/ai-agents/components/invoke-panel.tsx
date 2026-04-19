/**
 * <InvokePanel> — prompt box + "Invoke" button showing the mock response.
 *
 * Writes a trace via `invokeAgentMock`. Shows completion, tokens, latency, and
 * tool calls inline. Uses Mantine `<Code block>` for syntax display (Shiki
 * lazy-load is deferred to trace viewer).
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Stack,
  Table,
  Text,
  Textarea,
} from '@mantine/core';
import { IconAlertCircle, IconPlayerPlay } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { formatCost, formatTokens } from '@/features/ai-shared';
import { invokeAgentMock } from '../api';
import type { AiTrace } from '../types';

interface InvokePanelProps {
  agentId: string;
}

export function InvokePanel({ agentId }: InvokePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [invoking, setInvoking] = useState(false);
  const [trace, setTrace] = useState<AiTrace | null>(null);

  async function handleInvoke() {
    if (prompt.trim() === '') return;
    setInvoking(true);
    setTrace(null);
    try {
      const result = await invokeAgentMock(agentId, { prompt });
      setTrace(result);
      if (result.status === 'success') {
        notify.success(
          'Agent invoked',
          `${String(result.latency_ms)}ms · ${formatTokens(
            result.input_tokens + result.output_tokens,
          )} tokens`,
        );
      } else {
        notify.error(
          'Agent failed',
          result.error_message ?? 'Unknown error',
        );
      }
    } catch {
      notify.error('Failed to invoke agent', 'Please try again.');
    } finally {
      setInvoking(false);
    }
  }

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        Invoke
      </Text>
      <Textarea
        placeholder="Enter a prompt to test this agent…"
        minRows={3}
        maxRows={8}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.currentTarget.value);
        }}
        aria-label="Prompt"
      />
      <Group justify="flex-end">
        <Button
          size="xs"
          leftSection={<IconPlayerPlay size={14} />}
          loading={invoking}
          disabled={prompt.trim() === ''}
          onClick={() => void handleInvoke()}
        >
          Invoke
        </Button>
      </Group>

      {trace && trace.status === 'success' && (
        <Stack gap="xs">
          <Group gap="xs">
            <Badge color="green" variant="light" size="sm">
              {trace.status}
            </Badge>
            <Badge color="blue" variant="light" size="sm">
              {String(trace.latency_ms)}ms
            </Badge>
            <Badge color="gray" variant="light" size="sm">
              {formatTokens(trace.input_tokens)} in · {formatTokens(trace.output_tokens)} out
            </Badge>
            <Badge color="gray" variant="light" size="sm">
              {formatCost(trace.cost_usd)}
            </Badge>
          </Group>
          <Code block>{trace.completion_text}</Code>
          {trace.tool_calls.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" fw={600}>
                Tool calls ({String(trace.tool_calls.length)})
              </Text>
              <Table withTableBorder striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Tool</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Latency</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {trace.tool_calls.map((c, idx) => (
                    <Table.Tr key={`${c.tool_id}-${String(idx)}`}>
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {c.tool_name}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="xs"
                          color={c.status === 'success' ? 'green' : 'red'}
                          variant="light"
                        >
                          {c.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{String(c.latency_ms)}ms</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          )}
        </Stack>
      )}

      {trace && trace.status !== 'success' && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
        >
          <Text size="sm" fw={600}>
            Invocation {trace.status}
          </Text>
          {trace.error_message && (
            <Text size="xs" mt={4}>
              {trace.error_message}
            </Text>
          )}
        </Alert>
      )}
    </Stack>
  );
}
