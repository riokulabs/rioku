/**
 * <TestPanel> — sample-input JsonInput + Test button for a tool.
 *
 * Calls `testTool` and shows the mock result or the schema-validation error
 * inline.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  JsonInput,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertCircle, IconPlayerPlay } from '@tabler/icons-react';
import { testTool } from '../api';
import type { TestToolResult } from '../types';

interface TestPanelProps {
  toolId: string;
}

export function TestPanel({ toolId }: TestPanelProps) {
  const [sample, setSample] = useState<string>('{\n  \n}');
  const [parseError, setParseError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestToolResult | null>(null);

  async function handleTest() {
    setParseError(null);
    setResult(null);
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
      const r = await testTool(toolId, parsed);
      setResult(r);
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

      {result && result.ok && (
        <Stack gap="xs">
          <Badge color="green" variant="light" size="sm">
            Validation passed
          </Badge>
          <Code block>{JSON.stringify(result.result, null, 2)}</Code>
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
