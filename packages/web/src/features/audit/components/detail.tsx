/**
 * <AuditDetail> — drawer content for a single audit entry.
 *
 * Sections:
 *   - Header:        timestamp (full ISO + relative), actor chip, action,
 *                    outcome + tier badges, request_id IdBadge
 *   - Context:       IP + user_agent (permission-gated on
 *                    audit:read-sensitive; `[redacted]` fallback), TOTP icon
 *   - Payload:       Shiki-highlighted JSON (hidden when no payload)
 *   - Diff:          when action matches /policy\.(create|update)/ and
 *                    both sides have a `condition` string, render <CelDiff>
 *                    on the condition field only. Otherwise fall back to
 *                    <DiffView> over the full JSON objects. Hidden when no
 *                    diff is present.
 *   - Policies evaluated: one row per policy with decision chip + reason.
 *   - Actions:       Copy request_id, Copy as cURL (stub), Export entry JSON.
 */
import { useMemo } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  CopyButton,
  Divider,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconDownload,
  IconShieldCheck,
  IconTerminal2,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { CodeBlock } from '@/components/code-block';
import { DiffView } from '@/components/diff-view';
import { IdBadge } from '@/components/id-badge';
import { StatusBadge } from '@/components/status-badge';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import type { AuditEntry } from '@/api/resources/types';
import { CelDiff } from './cel-diff';

dayjs.extend(relativeTime);

const OUTCOME_KIND = {
  success: 'success',
  denied: 'warn',
  error: 'error',
} as const satisfies Record<AuditEntry['outcome'], 'success' | 'warn' | 'error'>;

const TIER_COLOR: Record<AuditEntry['tier'], string> = {
  read: 'blue',
  'read-sensitive': 'violet',
  write: 'yellow',
  destructive: 'red',
};

const POLICY_ACTION_RE = /(access-policy|rbac-policy|policy)\.(create|update)/;

const REDACTED = '[redacted]';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Extract the `condition` field from a policy-diff side. Returns `null` when
 * the shape is not recognised — callers fall back to whole-object diffing.
 */
function extractCondition(side: unknown): string | null {
  if (!isObject(side)) return null;
  const c = side.condition;
  return typeof c === 'string' ? c : null;
}

function buildCurl(entry: AuditEntry): string {
  const reqHeader = entry.request_id ? `  -H 'X-Rioku-Request-Id: ${entry.request_id}' \\` : '';
  return [
    `curl -X POST 'https://api.example.com/v1/audit/replay' \\`,
    `  -H 'Authorization: Bearer $RIOKU_API_KEY' \\`,
    `  -H 'Content-Type: application/json' \\`,
    reqHeader,
    `  -d '${JSON.stringify({
      entry_id: entry.id,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
    })}'`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface AuditDetailProps {
  entry: AuditEntry;
  onClose: () => void;
}

export function AuditDetail({ entry, onClose: _onClose }: AuditDetailProps) {
  const users = useMockStore((s) => s.users);
  const canReadSensitive = usePermission('audit:read-sensitive');

  const actorName = users[entry.actor_id]?.name ?? entry.actor_id;
  const actorEmail = users[entry.actor_id]?.email;
  const absoluteTs = dayjs(entry.at).format('YYYY-MM-DD HH:mm:ss');
  const relativeTs = dayjs(entry.at).fromNow();

  const ipDisplay = !entry.ip ? null : canReadSensitive ? entry.ip : REDACTED;
  const uaDisplay = !entry.user_agent ? null : canReadSensitive ? entry.user_agent : REDACTED;

  // Diff handling — prefer CelDiff on policy writes when both sides carry a
  // `condition` string; otherwise JSON diff; otherwise hide the section.
  const diffSection = useMemo(() => {
    if (!entry.diff) return null;
    const { before, after } = entry.diff;
    const isPolicyWrite = POLICY_ACTION_RE.test(entry.action);
    if (isPolicyWrite) {
      const beforeCondition = extractCondition(before);
      const afterCondition = extractCondition(after);
      if (beforeCondition !== null || afterCondition !== null) {
        return (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Policy condition
            </Text>
            <CelDiff before={beforeCondition ?? ''} after={afterCondition ?? ''} />
          </Stack>
        );
      }
    }
    return (
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Change
        </Text>
        <DiffView before={before} after={after} label="Before / After" />
      </Stack>
    );
  }, [entry.diff, entry.action]);

  const payloadJson = useMemo(() => {
    if (entry.payload === undefined) return null;
    if (!canReadSensitive) {
      return JSON.stringify({ payload: REDACTED }, null, 2);
    }
    try {
      return JSON.stringify(entry.payload, null, 2);
    } catch {
      return null;
    }
  }, [entry.payload, canReadSensitive]);

  function handleExportJson() {
    try {
      const blob = new Blob([JSON.stringify(entry, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${entry.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify.success('Exported', `Downloaded audit entry ${entry.id}.`);
    } catch {
      notify.error('Export failed', 'Please try again.');
    }
  }

  const curl = buildCurl(entry);

  return (
    <Stack gap="md" data-testid="audit-detail">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs" align="center" wrap="wrap">
            <Title order={4} ff="monospace">
              {entry.action}
            </Title>
            <StatusBadge kind={OUTCOME_KIND[entry.outcome]} size="sm">
              {entry.outcome}
            </StatusBadge>
            <Badge size="sm" variant="outline" color={TIER_COLOR[entry.tier]}>
              {entry.tier}
            </Badge>
            {entry.totp_verified === true && (
              <Tooltip label="TOTP verified" withArrow>
                <IconShieldCheck
                  size={16}
                  color="var(--mantine-color-teal-6)"
                  aria-label="TOTP verified"
                  role="img"
                />
              </Tooltip>
            )}
          </Group>
          <Group gap="xs" align="center" wrap="wrap">
            <Text size="xs" fw={500}>
              {actorName}
            </Text>
            {actorEmail && (
              <Text size="xs" ff="monospace">
                &lt;{actorEmail}&gt;
              </Text>
            )}
            <Tooltip label={absoluteTs} withArrow>
              <Text size="xs">{relativeTs}</Text>
            </Tooltip>
          </Group>
          {entry.request_id && (
            <Group gap="xs" align="center">
              <Text size="xs">request:</Text>
              <IdBadge id={entry.request_id} />
            </Group>
          )}
        </Stack>
      </Group>

      {entry.acted_as_admin && (
        <Alert
          color="violet"
          variant="light"
          icon={<IconAlertCircle size={16} />}
          title="Super-admin action"
          data-testid="audit-admin-banner"
        >
          This action was performed by a super-admin
          {entry.impersonation_session_id
            ? ` during impersonation session ${entry.impersonation_session_id}`
            : ''}
          .
        </Alert>
      )}

      {/* Context */}
      <Stack gap={4}>
        <Text size="sm" fw={600}>
          Context
        </Text>
        <Group gap="md" wrap="wrap">
          <Text size="xs">
            <strong>Resource:</strong> {entry.resource_type}
            {entry.resource_id ? `:${entry.resource_id}` : ''}
          </Text>
          {ipDisplay !== null && (
            <Text size="xs" data-testid="audit-ip">
              <strong>IP:</strong> {ipDisplay}
            </Text>
          )}
          {uaDisplay !== null && (
            <Text size="xs" data-testid="audit-user-agent">
              <strong>User-Agent:</strong> {uaDisplay}
            </Text>
          )}
        </Group>
      </Stack>

      {/* Payload */}
      {payloadJson !== null && (
        <Stack gap="xs" data-testid="audit-payload-section">
          <Text size="sm" fw={600}>
            Payload
          </Text>
          <CodeBlock code={payloadJson} language="json" maxHeight={280} />
        </Stack>
      )}

      {/* Diff */}
      {diffSection && (
        <Box data-testid="audit-diff-section">
          <Divider my="xs" />
          {diffSection}
        </Box>
      )}

      {/* Policies evaluated */}
      {entry.policies_evaluated && entry.policies_evaluated.length > 0 && (
        <Stack gap="xs" data-testid="audit-policies-section">
          <Text size="sm" fw={600}>
            Policies evaluated ({String(entry.policies_evaluated.length)})
          </Text>
          <Stack gap={4}>
            {entry.policies_evaluated.map((p) => (
              <Group key={p.policy_id} gap="xs" align="center" wrap="wrap">
                <Badge size="xs" color={p.decision === 'allow' ? 'green' : 'red'} variant="light">
                  {p.decision}
                </Badge>
                <IdBadge id={p.policy_id} />
                {p.reason && <Text size="xs">{p.reason}</Text>}
              </Group>
            ))}
          </Stack>
        </Stack>
      )}

      <Divider />

      {/* Actions */}
      <Group gap="sm" wrap="wrap">
        {entry.request_id && (
          <CopyButton value={entry.request_id} timeout={2000}>
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
        )}
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
          onClick={handleExportJson}
          data-testid="audit-export-json"
        >
          Export entry JSON
        </Button>
      </Group>
    </Stack>
  );
}
