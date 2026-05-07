/**
 * <TraceDetail> — drawer/full-page content for an AI trace.
 *
 * Daemon-backed: fetches the trace via Orval `useGetAITrace`. Prompts and
 * completions are redacted-by-default; viewers with `ai-trace:read-sensitive`
 * see a "Reveal" button that opens a justification modal. On confirm
 * (reason ≥ 10 chars) the component POSTs to `/reveal`, swaps the redacted
 * fields with the unmasked payload, and surfaces a "revealed" badge that
 * doubles as an audit-trail breadcrumb.
 *
 * Test contract — testids:
 *   trace-detail, trace-redacted, trace-reveal-button, trace-reveal-modal,
 *   trace-reveal-reason, trace-reveal-confirm, trace-revealed-badge,
 *   trace-prompt-completion, trace-error-alert.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconAlertCircle, IconEye, IconHistory, IconLock } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { usePermission } from '@/hooks/use-permission';
import { notify } from '@/hooks/use-notify';
import { IdBadge } from '@/components/id-badge';
import { formatTokens } from '@/features/ai-shared';
import { useTraceDetail, revealTrace } from '../api';
import type { AiTrace } from '@/api/resources';
import { PromptCompletionView } from './prompt-completion-view';
import { ToolCallList } from './tool-call-list';

dayjs.extend(relativeTime);

const STATUS_COLOR: Record<AiTrace['status'], string> = {
  success: 'green',
  error: 'red',
  timeout: 'yellow',
};

const MIN_REASON_LENGTH = 10;

interface TraceDetailProps {
  traceId: string;
  tenantSlug: string;
  onClose: () => void;
}

export function TraceDetail({ traceId, tenantSlug, onClose: _onClose }: TraceDetailProps) {
  const { trace, isLoading, isMissing } = useTraceDetail(tenantSlug, traceId);
  const canReveal = usePermission('ai-trace:read-sensitive');

  const [revealOpen, setRevealOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [unmasked, setUnmasked] = useState<{ prompt: string; completion: string } | null>(null);

  if (isMissing) {
    return (
      <Alert
        color="red"
        variant="light"
        icon={<IconAlertCircle size={16} />}
        data-testid="trace-not-found"
      >
        Trace not found.
      </Alert>
    );
  }

  if (isLoading || !trace) {
    return (
      <Stack gap="md" data-testid="trace-detail-loading">
        <Group gap="xs" align="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading trace…
          </Text>
        </Group>
      </Stack>
    );
  }

  const absolute = dayjs(trace.at).format('YYYY-MM-DD HH:mm:ss');
  const totalTokens = trace.input_tokens + trace.output_tokens;

  const promptText = unmasked?.prompt ?? trace.prompt_text;
  const completionText = unmasked?.completion ?? trace.completion_text;
  const isUnmasked = unmasked !== null;

  function openReveal() {
    setReason('');
    setRevealOpen(true);
  }

  async function confirmReveal() {
    if (reason.length < MIN_REASON_LENGTH) return;
    setRevealing(true);
    try {
      const revealed = await revealTrace(tenantSlug, traceId, reason);
      setUnmasked({
        prompt: revealed.prompt_text,
        completion: revealed.completion_text,
      });
      setRevealOpen(false);
      notify.success('Trace revealed', 'Reveal recorded in the audit log.');
    } catch (e) {
      notify.error('Reveal failed', (e as Error).message);
    } finally {
      setRevealing(false);
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
              {trace.agent_id}
            </Title>
            <Badge size="sm" variant="light" color={STATUS_COLOR[trace.status]}>
              {trace.status}
            </Badge>
            {isUnmasked && (
              <Badge
                size="sm"
                variant="filled"
                color="orange"
                leftSection={<IconEye size={10} />}
                data-testid="trace-revealed-badge"
              >
                Revealed
              </Badge>
            )}
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
              {trace.model}
            </Text>
          </Group>
        </Stack>
        {canReveal && !isUnmasked && (
          <Button
            size="xs"
            variant="light"
            color="orange"
            leftSection={<IconEye size={14} />}
            onClick={openReveal}
            data-testid="trace-reveal-button"
          >
            Reveal
          </Button>
        )}
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

      {/* Prompt + completion (gated). */}
      <PromptCompletionView
        prompt={promptText}
        completion={completionText}
        unmasked={isUnmasked}
      />

      {/* Tool calls */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Tool calls ({String(trace.tool_calls.length)})
        </Text>
        <ToolCallList calls={trace.tool_calls} />
      </Stack>

      {/* Reveal-justification modal. */}
      <Modal
        opened={revealOpen}
        onClose={() => {
          setRevealOpen(false);
        }}
        title="Reveal sensitive trace contents"
        centered
        size="md"
        transitionProps={{ duration: 0 }}
        data-testid="trace-reveal-modal"
      >
        <Stack gap="sm">
          <Alert color="orange" variant="light" icon={<IconLock size={16} />}>
            Reveals are recorded in the audit log. Provide a justification of at least{' '}
            {String(MIN_REASON_LENGTH)} characters.
          </Alert>
          <Textarea
            label="Reason"
            placeholder="e.g. Investigating incident #1234 for tenant escalation"
            minRows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.currentTarget.value);
            }}
            data-testid="trace-reveal-reason"
          />
          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              size="xs"
              onClick={() => {
                setRevealOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              color="orange"
              size="xs"
              onClick={() => {
                void confirmReveal();
              }}
              disabled={reason.length < MIN_REASON_LENGTH || revealing}
              loading={revealing}
              data-testid="trace-reveal-confirm"
            >
              Reveal
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Filler element to satisfy unused-var lints in non-test consumers that
          formerly read trace.cost_usd / trace.provider_id off this view. */}
      <Box hidden aria-hidden>
        {trace.provider_id}
      </Box>
    </Stack>
  );
}
