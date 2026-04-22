/**
 * <TraceDetail> — drawer content for an AI trace.
 *
 * Sections:
 *   - Header: request_id IdBadge, agent name, timestamp, status chip, tokens,
 *     cost, latency.
 *   - Provider + model chips.
 *   - <PromptCompletionView> — Shiki-highlighted prompt + completion, gated
 *     on ai-trace:read-sensitive.
 *   - <ToolCallList> — Mantine Timeline of tool calls with collapsible
 *     args/result panels.
 *   - Error message Alert (role="alert") when status === 'error'.
 *   - Actions row: Copy request_id, Copy as cURL (mock), Export JSON,
 *     "View all traces for this agent" cross-link.
 */
import {
  Alert,
  Badge,
  Button,
  CopyButton,
  Divider,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { Link } from '@tanstack/react-router';
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconHistory,
  IconTerminal2,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';

dayjs.extend(relativeTime);
import { notify } from '@/hooks/use-notify';
import { IdBadge } from '@/components/id-badge';
import { ProviderKindBadge, formatCost, formatTokens } from '@/features/ai-shared';
import { useTraceDetail } from '../api';
import type { AiTrace } from '@/api/resources/types';
import { PromptCompletionView } from './prompt-completion-view';
import { ToolCallList } from './tool-call-list';

const STATUS_COLOR: Record<AiTrace['status'], string> = {
  success: 'green',
  error: 'red',
  timeout: 'yellow',
};

/** Mocked cURL shape — real LLM APIs differ across providers; this is a
 *  conservative OpenAI-style template that works as a "copy for reference"
 *  affordance in the admin. */
function buildMockCurl(trace: AiTrace, providerBaseUrl: string | undefined): string {
  const base = providerBaseUrl ?? 'https://api.example.com';
  return [
    `curl -X POST '${base}/v1/chat/completions' \\`,
    `  -H 'Authorization: Bearer $OPENAI_API_KEY' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'X-Rioku-Trace-Id: ${trace.request_id}' \\`,
    `  -d '{"model":"${trace.model}","messages":[{"role":"user","content":"..."}]}'`,
  ].join('\n');
}

interface TraceDetailProps {
  traceId: string;
  tenantSlug: string;
  onClose: () => void;
}

export function TraceDetail({ traceId, tenantSlug, onClose: _onClose }: TraceDetailProps) {
  const trace = useTraceDetail(traceId);
  const agents = useMockStore((s) => s.aiAgents);
  const providers = useMockStore((s) => s.aiProviders);

  if (!trace) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Trace not found.
      </Alert>
    );
  }

  const agent = agents[trace.agent_id];
  const provider = providers[trace.provider_id];
  const absolute = dayjs(trace.at).format('YYYY-MM-DD HH:mm:ss');
  const totalTokens = trace.input_tokens + trace.output_tokens;
  const curl = buildMockCurl(trace, provider?.base_url);

  function handleExportJson(t: AiTrace) {
    try {
      const blob = new Blob([JSON.stringify(t, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trace-${t.request_id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify.success('Exported', `Downloaded trace ${t.request_id}.`);
    } catch {
      notify.error('Export failed', 'Please try again.');
    }
  }

  return (
    <Stack gap="md" data-testid="trace-detail">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs" align="center" wrap="wrap">
            <IconHistory size={20} color="var(--mantine-color-blue-6)" />
            <Title order={4} ff="monospace">
              {agent?.name ?? trace.agent_id}
            </Title>
            <Badge size="sm" variant="light" color={STATUS_COLOR[trace.status]}>
              {trace.status}
            </Badge>
          </Group>
          <Group gap="xs" align="center" wrap="wrap">
            <Text size="xs" c="var(--mantine-color-gray-7)">
              request:
            </Text>
            <IdBadge id={trace.request_id} />
            <Tooltip label={absolute} withArrow>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                {dayjs(trace.at).fromNow()}
              </Text>
            </Tooltip>
          </Group>
          <Group gap="md" mt={4}>
            <Text size="xs" ff="monospace">
              {formatTokens(trace.input_tokens)} → {formatTokens(trace.output_tokens)} (=
              {formatTokens(totalTokens)})
            </Text>
            <Text size="xs" ff="monospace">
              {String(trace.latency_ms)}ms
            </Text>
            <Text size="xs" ff="monospace">
              {formatCost(trace.cost_usd)}
            </Text>
          </Group>
        </Stack>
      </Group>

      {/* Provider + model */}
      <Group gap="xs" align="center" wrap="wrap">
        {provider && <ProviderKindBadge kind={provider.kind} />}
        <Text size="xs" ff="monospace">
          {provider?.name ?? trace.provider_id}
        </Text>
        <Badge size="xs" variant="outline" color="blue" ff="monospace">
          {trace.model}
        </Badge>
      </Group>

      {/* Error message if applicable */}
      {trace.status === 'error' && trace.error_message && (
        <Alert
          color="red"
          variant="light"
          icon={<IconAlertCircle size={16} />}
          title="Error"
          role="alert"
          data-testid="trace-error-alert"
        >
          {trace.error_message}
        </Alert>
      )}

      <Divider />

      {/* Prompt + completion */}
      <PromptCompletionView prompt={trace.prompt_text} completion={trace.completion_text} />

      <Divider />

      {/* Tool calls */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Tool calls ({String(trace.tool_calls.length)})
        </Text>
        <ToolCallList calls={trace.tool_calls} />
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm" wrap="wrap">
        <CopyButton value={trace.request_id} timeout={2000}>
          {({ copied, copy }) => (
            <Button
              size="xs"
              variant="default"
              leftSection={copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
              onClick={copy}
              {...(copied ? { color: 'teal' as const } : {})}
            >
              {copied ? 'Copied ID' : 'Copy request ID'}
            </Button>
          )}
        </CopyButton>
        <CopyButton value={curl} timeout={2000}>
          {({ copied, copy }) => (
            <Button
              size="xs"
              variant="default"
              leftSection={copied ? <IconCheck size={12} /> : <IconTerminal2 size={12} />}
              onClick={copy}
              {...(copied ? { color: 'teal' as const } : {})}
            >
              {copied ? 'Copied cURL' : 'Copy as cURL'}
            </Button>
          )}
        </CopyButton>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconDownload size={12} />}
          onClick={() => {
            handleExportJson(trace);
          }}
        >
          Export JSON
        </Button>
        {agent && (
          <Button
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
            component={Link as any}
            to="/t/$tenant/ai/traces"
            params={{ tenant: tenantSlug }}
            search={{ agent: agent.id, range: '24h' }}
            size="xs"
            variant="subtle"
            rightSection={<IconExternalLink size={12} />}
          >
            View all traces for this agent
          </Button>
        )}
      </Group>
    </Stack>
  );
}
