/**
 * <TestPanel> — sample-input JsonInput + Test button for a tool.
 *
 * Calls the daemon `/test` schema-validation stub and shows the result or
 * the validation error inline. For real invocation see `TestInvocation`
 * inside `<ToolFullPage>`.
 */
import { useState } from 'react';
import { Alert, Badge, Button, Code, Group, JsonInput, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconPlayerPlay } from '@tabler/icons-react';
import { testTool } from '../api';
import type { TestToolResult } from '../types';

interface TestPanelProps {
  tenant: string;
  toolId: string;
}

export function TestPanel({ tenant, toolId }: TestPanelProps) {
  const [sample, setSample] = useState<string>('{\n  \n}');
  const [parseError, setParseError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestToolResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  async function handleTest() {
    setParseError(null);
    setResult(null);
    setCallError(null);
    let parsed: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(sample);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        setParseError('Sample input must be a JSON object');
        return;
      }
      parsed = v as Record<string, unknown>;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
      return;
    }
    setTesting(true);
    try {
      const r = await testTool(tenant, toolId, parsed);
      setResult(r);
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Tool test failed');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        Test
      </Text>
      <JsonInput
        label="Sample input"
        value={sample}
        onChange={setSample}
        minRows={6}
        formatOnBlur
        aria-label="Sample input"
      />
      <Group justify="flex-end">
        <Button
          size="xs"
          leftSection={<IconPlayerPlay size={14} />}
          loading={testing}
          onClick={() => void handleTest()}
        >
          Test
        </Button>
      </Group>

      {parseError && (
        <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">
          {parseError}
        </Alert>
      )}

      {callError && (
        <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">
          {callError}
        </Alert>
      )}

      {result && result.ok && (
        <Stack gap="xs">
          <Badge color="green" variant="light" size="sm">
            Validation passed
          </Badge>
          <Code block>{JSON.stringify(result.result ?? result, null, 2)}</Code>
        </Stack>
      )}

      {result && !result.ok && (
        <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">
          {result.error ?? 'Validation failed'}
        </Alert>
      )}
    </Stack>
  );
}
