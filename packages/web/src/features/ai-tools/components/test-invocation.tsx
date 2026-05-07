/**
 * <TestInvocation> — JSON input → POST /invoke → render result.
 *
 * Renders a Monaco JSON editor for the request body and a results panel
 * showing pretty-printed output, wall-clock duration and (when present)
 * tokens used. Errors are surfaced inline.
 *
 * The real "Invoke" button is gated by the `ai-tool:invoke` permission;
 * viewers see a disabled button + tooltip.
 */
import { useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import Editor from '@monaco-editor/react';
import { IconAlertCircle, IconPlayerPlay } from '@tabler/icons-react';
import { usePermission } from '@/hooks/use-permission';
import { useInvokeTool } from '../api';
import type { InvokeToolResult } from '../types';

interface TestInvocationProps {
  tenant: string;
  toolId: string;
  /** Optional pre-filled JSON body (e.g. from a prior run). */
  initialInput?: string;
}

const DEFAULT_INPUT = '{\n  \n}';

export function TestInvocation({ tenant, toolId, initialInput }: TestInvocationProps) {
  const canInvoke = usePermission('ai-tool:invoke');
  const invokeMutation = useInvokeTool(tenant);

  const [source, setSource] = useState<string>(initialInput ?? DEFAULT_INPUT);
  const [parseError, setParseError] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [result, setResult] = useState<InvokeToolResult | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const [clientDurationMs, setClientDurationMs] = useState<number | null>(null);

  function handleSourceChange(v: string | undefined) {
    setSource(v ?? '');
    if (parseError !== null) setParseError(null);
  }

  function handleInvoke() {
    setParseError(null);
    setCallError(null);
    setResult(null);
    setClientDurationMs(null);

    let parsed: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(source);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        setParseError('Input must be a JSON object');
        return;
      }
      parsed = v as Record<string, unknown>;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
      return;
    }

    startedAtRef.current = performance.now();
    invokeMutation.mutate(
      { id: toolId, input: parsed },
      {
        onSuccess: (data) => {
          setResult(data);
          if (startedAtRef.current !== null) {
            setClientDurationMs(Math.round(performance.now() - startedAtRef.current));
          }
        },
        onError: (err) => {
          setCallError(err instanceof Error ? err.message : 'Invocation failed');
          if (startedAtRef.current !== null) {
            setClientDurationMs(Math.round(performance.now() - startedAtRef.current));
          }
        },
      },
    );
  }

  const durationMs = result?.duration_ms ?? clientDurationMs;
  const tokensUsed = result?.tokens_used;

  const button = (
    <Button
      leftSection={<IconPlayerPlay size={14} />}
      loading={invokeMutation.isPending}
      onClick={handleInvoke}
      disabled={!canInvoke}
      data-testid="invoke-button"
    >
      Invoke
    </Button>
  );

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Input (JSON)
        </Text>
        <Editor
          height={240}
          defaultLanguage="json"
          language="json"
          value={source}
          onChange={handleSourceChange}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            tabSize: 2,
            ariaLabel: 'Tool invocation input',
            automaticLayout: true,
          }}
        />
      </Stack>

      <Group justify="flex-end">
        {canInvoke ? (
          button
        ) : (
          <Tooltip label="You need ai-tool:invoke to run this tool" withArrow>
            <span>{button}</span>
          </Tooltip>
        )}
      </Group>

      {parseError && (
        <Alert
          icon={<IconAlertCircle size={14} />}
          color="red"
          variant="light"
          data-testid="invoke-parse-error"
        >
          {parseError}
        </Alert>
      )}

      {callError && (
        <Alert
          icon={<IconAlertCircle size={14} />}
          color="red"
          variant="light"
          data-testid="invoke-call-error"
        >
          {callError}
        </Alert>
      )}

      {result && (
        <Stack gap="xs" data-testid="invoke-result">
          <Group gap="xs">
            <Badge color={result.ok ? 'green' : 'red'} variant="light" size="sm">
              {result.ok ? 'success' : 'failed'}
            </Badge>
            {durationMs !== null && (
              <Badge variant="light" color="gray" size="sm" data-testid="invoke-duration">
                {durationMs} ms
              </Badge>
            )}
            {tokensUsed !== undefined && (
              <Badge variant="light" color="blue" size="sm" data-testid="invoke-tokens">
                {tokensUsed} tokens
              </Badge>
            )}
          </Group>

          {result.ok && (
            <Stack gap={4}>
              <Text size="xs" fw={600} tt="uppercase" c="var(--mantine-color-gray-7)">
                Output
              </Text>
              <Code block data-testid="invoke-output">
                {JSON.stringify(result.output ?? null, null, 2)}
              </Code>
            </Stack>
          )}

          {!result.ok && (
            <Alert
              icon={<IconAlertCircle size={14} />}
              color="red"
              variant="light"
              data-testid="invoke-result-error"
            >
              {result.error ?? 'Tool returned ok=false with no error message'}
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  );
}
