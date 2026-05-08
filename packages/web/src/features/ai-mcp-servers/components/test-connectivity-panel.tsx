/**
 * <TestConnectivityPanel> — Tabs panel for the "Test connectivity" tab.
 *
 * Renders a "Test connection" button that POSTs to
 * `/api/v1/t/{tenant}/ai/mcp-servers/{id}/test`. Displays a status badge
 * (OK / FAIL), latency, server version (when reported), and the underlying
 * error message on failure.
 */
import { useState } from 'react';
import { Alert, Badge, Button, Card, Code, Group, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconPlugConnected } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useTestMcpServer } from '../api';
import type { TestMcpServerResult } from '../types';

interface TestConnectivityPanelProps {
  tenant: string;
  serverId: string;
}

interface ResultEntry {
  result: TestMcpServerResult;
  at: string;
}

export function TestConnectivityPanel({ tenant, serverId }: TestConnectivityPanelProps) {
  const mutation = useTestMcpServer(tenant);
  const [history, setHistory] = useState<ResultEntry[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function runTest() {
    setSubmitError(null);
    try {
      const result = await mutation.mutateAsync(serverId);
      setHistory((prev) => [{ result, at: new Date().toISOString() }, ...prev].slice(0, 5));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to test connection';
      setSubmitError(msg);
    }
  }

  const latest = history[0]?.result;

  return (
    <Stack gap="md">
      <Card withBorder padding="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text fw={600}>Connectivity probe</Text>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Issues an HTTP probe against the server&apos;s configured URL (5s timeout).
                Reachable but non-2xx responses are reported as <Code>ok</Code> — many MCP endpoints
                respond 401/404 to a bare GET.
              </Text>
            </div>
            <Button
              leftSection={<IconPlugConnected size={14} />}
              loading={mutation.isPending}
              onClick={() => void runTest()}
              data-testid="mcp-test-connection-button"
            >
              Test connection
            </Button>
          </Group>

          {submitError && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              {submitError}
            </Alert>
          )}

          {latest && <ResultCard result={latest} />}
        </Stack>
      </Card>

      {history.length > 1 && (
        <Card withBorder padding="md">
          <Stack gap="xs">
            <Text fw={600}>Recent probes</Text>
            {history.slice(1).map((h) => (
              <Group key={h.at} gap="sm" align="center" data-testid="mcp-test-history-row">
                <Badge size="sm" color={h.result.ok ? 'teal' : 'red'} variant="light">
                  {h.result.ok ? 'OK' : 'FAIL'}
                </Badge>
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  {dayjs(h.at).format('HH:mm:ss')} · {String(h.result.latency_ms)} ms
                </Text>
                {h.result.error && (
                  <Text size="xs" c="red">
                    {h.result.error}
                  </Text>
                )}
              </Group>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

function ResultCard({ result }: { result: TestMcpServerResult }) {
  return (
    <Card withBorder padding="md" {...(result.ok ? {} : { bg: 'var(--mantine-color-red-0)' })}>
      <Stack gap="xs">
        <Group gap="sm" align="center">
          <Badge
            size="lg"
            color={result.ok ? 'teal' : 'red'}
            variant="light"
            data-testid="mcp-test-status-badge"
          >
            {result.ok ? 'OK' : 'FAIL'}
          </Badge>
          <Text size="sm" data-testid="mcp-test-latency">
            <Text span fw={600}>
              Latency:
            </Text>{' '}
            {String(result.latency_ms)} ms
          </Text>
          {result.server_version && (
            <Text size="sm" data-testid="mcp-test-server-version">
              <Text span fw={600}>
                Server:
              </Text>{' '}
              <Code>{result.server_version}</Code>
            </Text>
          )}
        </Group>
        {!result.ok && result.error && (
          <Alert
            color="red"
            variant="light"
            icon={<IconAlertCircle size={16} />}
            data-testid="mcp-test-error"
          >
            {result.error}
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
