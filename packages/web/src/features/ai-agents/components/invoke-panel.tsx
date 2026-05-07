/**
 * <InvokePanel> — prompt + variables JSON + Invoke button.
 *
 * Streams the daemon SSE response (`event: chunk` frames) and renders chunks
 * incrementally. Closes on `event: done` or `event: error`. The Abort button
 * cancels the in-flight stream.
 *
 * Endpoint: POST /api/v1/t/{tenant}/ai/agents/{id}/invoke (text/event-stream).
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
  Textarea,
  Tooltip,
} from '@mantine/core';
import { IconAlertCircle, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { usePermission } from '@/hooks/use-permission';
import { formatCost, formatTokens } from '@/features/ai-shared';
import { invokeAgent } from '../api';
import type { InvokeDoneSummary } from '../api';

interface InvokePanelProps {
  /** Tenant slug — used in the daemon URL. */
  tenant: string;
  agentId: string;
}

export function InvokePanel({ tenant, agentId }: InvokePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [variables, setVariables] = useState('');
  const [variablesError, setVariablesError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [chunks, setChunks] = useState<string[]>([]);
  const [summary, setSummary] = useState<InvokeDoneSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const canInvoke = usePermission('ai-agent:read');

  function reset() {
    setChunks([]);
    setSummary(null);
    setError(null);
    setVariablesError(null);
  }

  function handleInvoke() {
    if (prompt.trim() === '') return;
    if (variables.trim() !== '') {
      try {
        const v = JSON.parse(variables) as unknown;
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          setVariablesError('Variables must be a JSON object');
          return;
        }
      } catch {
        setVariablesError('Invalid JSON');
        return;
      }
    }

    reset();
    setStreaming(true);
    const handle = invokeAgent(
      tenant,
      agentId,
      { prompt },
      {
        onChunk: (c) => {
          setChunks((prev) => [...prev, c.text]);
        },
        onDone: (s) => {
          setSummary(s);
          setStreaming(false);
          abortRef.current = null;
        },
        onError: (err) => {
          setError(err.message);
          setStreaming(false);
          abortRef.current = null;
        },
      },
    );
    abortRef.current = handle.abort;
  }

  function handleAbort() {
    abortRef.current?.();
    abortRef.current = null;
    setStreaming(false);
    setError('Aborted');
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
      <Textarea
        placeholder='Optional variables JSON, e.g. {"name": "Ada"}'
        label="Variables (JSON)"
        minRows={2}
        maxRows={6}
        value={variables}
        onChange={(e) => {
          setVariables(e.currentTarget.value);
          setVariablesError(null);
        }}
        error={variablesError ?? undefined}
        aria-label="Variables"
      />
      <Group justify="flex-end" gap="xs">
        {streaming && (
          <Button
            size="xs"
            color="red"
            variant="subtle"
            leftSection={<IconPlayerStop size={14} />}
            onClick={handleAbort}
          >
            Abort
          </Button>
        )}
        <Tooltip
          disabled={canInvoke}
          label="You need the ai-agent:read permission to invoke agents"
        >
          <Button
            size="xs"
            leftSection={<IconPlayerPlay size={14} />}
            loading={streaming}
            disabled={!canInvoke || prompt.trim() === '' || streaming}
            onClick={handleInvoke}
          >
            Invoke
          </Button>
        </Tooltip>
      </Group>

      {(chunks.length > 0 || streaming) && (
        <Stack gap="xs" data-testid="invoke-output">
          <Group gap="xs">
            <Badge color={streaming ? 'blue' : 'green'} variant="light" size="sm">
              {streaming ? 'streaming…' : 'complete'}
            </Badge>
            {summary && (
              <>
                <Badge color="blue" variant="light" size="sm">
                  {String(summary.latencyMs)}ms
                </Badge>
                <Badge color="gray" variant="light" size="sm">
                  {formatTokens(summary.inputTokens)} in · {formatTokens(summary.outputTokens)} out
                </Badge>
                <Badge color="gray" variant="light" size="sm">
                  {formatCost(summary.costUsd)}
                </Badge>
              </>
            )}
          </Group>
          <Code block>{chunks.join('')}</Code>
        </Stack>
      )}

      {error !== null && (
        <Alert role="alert" icon={<IconAlertCircle size={16} />} color="red" variant="light">
          <Text size="sm" fw={600}>
            Invocation failed
          </Text>
          <Text size="xs" mt={4}>
            {error}
          </Text>
        </Alert>
      )}
    </Stack>
  );
}
