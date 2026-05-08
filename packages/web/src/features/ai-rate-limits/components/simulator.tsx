/**
 * <Simulator> — probe-style what-if simulator for a rate-limit rule.
 *
 * The operator sets a request_count, time_window_seconds and principal,
 * and the daemon's `/simulate` endpoint replies with would_throttle,
 * retry_after_ms, current_consumption and limit. The result renders as a
 * Badge + Progress bar + tabular breakdown so it's easy to scan.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Progress,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { IconAlertCircle, IconPlayerPlay } from '@tabler/icons-react';
import { useSimulateRateLimitProbeMutation } from '../api';

export interface SimulatorProps {
  tenantId: string;
  ruleId: string;
}

export function Simulator({ tenantId, ruleId }: SimulatorProps) {
  const [requestCount, setRequestCount] = useState<number | string>(50);
  const [windowSec, setWindowSec] = useState<number | string>(60);
  const [principal, setPrincipal] = useState<string>('');

  const mutation = useSimulateRateLimitProbeMutation(tenantId, ruleId);

  function handleSimulate() {
    mutation.mutate({
      request_count: typeof requestCount === 'number' ? requestCount : Number(requestCount) || 1,
      time_window_seconds: typeof windowSec === 'number' ? windowSec : Number(windowSec) || 60,
      principal: principal.trim(),
    });
  }

  const result = mutation.data;
  const limit = result?.limit ?? 0;
  const consumption = result?.current_consumption ?? 0;
  const consumptionPct = limit > 0 ? Math.min(100, Math.round((consumption / limit) * 100)) : 0;

  return (
    <Stack gap="sm" data-testid="rate-limit-simulator">
      <Text size="sm" fw={600}>
        Simulator
      </Text>

      <Group grow align="flex-end">
        <NumberInput
          label="Request count"
          value={requestCount}
          onChange={setRequestCount}
          min={1}
          aria-label="Request count"
          data-testid="simulator-request-count"
        />
        <NumberInput
          label="Time window (seconds)"
          value={windowSec}
          onChange={setWindowSec}
          min={1}
          aria-label="Time window seconds"
          data-testid="simulator-window-seconds"
        />
      </Group>
      <TextInput
        label="Principal"
        placeholder="user-123 / agent-id / tenant subject"
        value={principal}
        onChange={(e) => {
          setPrincipal(e.currentTarget.value);
        }}
        aria-label="Principal"
        data-testid="simulator-principal"
      />

      <Group justify="flex-end">
        <Button
          size="xs"
          leftSection={<IconPlayerPlay size={14} />}
          loading={mutation.isPending}
          onClick={handleSimulate}
          data-testid="simulator-run"
        >
          Simulate
        </Button>
      </Group>

      {mutation.isError && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={14} />}>
          Simulator failed: {mutation.error.message || 'unknown error'}
        </Alert>
      )}

      <div role="status" aria-live="polite">
        {result && (
          <Stack gap={6} data-testid="simulator-result">
            <Group gap="xs">
              <Badge
                color={result.would_throttle ? 'red' : 'green'}
                variant="light"
                size="sm"
                data-testid="simulator-would-throttle"
              >
                {result.would_throttle ? 'Would throttle' : 'Within limit'}
              </Badge>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                consumption {consumption} / {limit}
              </Text>
              {result.would_throttle && (
                <Text size="xs" c="var(--mantine-color-red-7)">
                  retry after {result.retry_after_ms}ms
                </Text>
              )}
            </Group>
            <Progress.Root size="md">
              <Progress.Section
                value={consumptionPct}
                color={result.would_throttle ? 'red' : 'blue'}
                aria-label={`Consumption ${String(consumptionPct)} percent`}
              />
            </Progress.Root>
            <Table withTableBorder withColumnBorders striped>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Th>would_throttle</Table.Th>
                  <Table.Td data-testid="simulator-result-throttle">
                    {String(result.would_throttle)}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>retry_after_ms</Table.Th>
                  <Table.Td>{result.retry_after_ms}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>current_consumption</Table.Th>
                  <Table.Td>{result.current_consumption}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>limit</Table.Th>
                  <Table.Td>{result.limit}</Table.Td>
                </Table.Tr>
                {result.principal !== undefined && result.principal !== '' && (
                  <Table.Tr>
                    <Table.Th>principal</Table.Th>
                    <Table.Td>{result.principal}</Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Stack>
        )}
      </div>
    </Stack>
  );
}
