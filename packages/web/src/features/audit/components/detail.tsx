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
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  CopyButton,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconDownload,
  IconEye,
  IconShieldCheck,
  IconTerminal2,
} from '@tabler/icons-react';
import { emitHostEvent } from '@/host/events';
import { useRevealAuditEntry } from '@/api/generated/audit/audit';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { CodeBlock } from '@/components/code-block';
import { DiffView } from '@/components/diff-view';
import { IdBadge } from '@/components/id-badge';
import { StatusBadge } from '@/components/status-badge';
import { useUserList } from '@/features/security/users/api';
import { useActiveTenantSlug } from '@/hooks/use-tenant';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import type { AuditEntry } from '@/api/resources';
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
  const tenantId = useActiveTenantSlug() ?? '';
  const userList = useUserList(tenantId, { search: '', status: 'all' });
  const users = useMemo(() => {
    const m: Record<string, { name: string; email: string }> = {};
    for (const { user } of userList.items) {
      m[user.id] = { name: user.name, email: user.email };
    }
    return m;
  }, [userList.items]);
  const canReadSensitive = usePermission('audit:read-sensitive');

  // Reveal flow: even when the caller holds `audit:read-sensitive`,
  // sensitive fields stay hidden behind a Reveal button. Clicking opens
  // a confirmation modal asking for a reason; on confirm we emit a
  // `audit:sensitive-revealed` host event (recorded as a follow-up
  // audit row by the daemon at stage-2-real time) and unmask locally.
  const [revealed, setRevealed] = useState(false);
  const [revealModalOpen, setRevealModalOpen] = useState(false);
  const [revealReason, setRevealReason] = useState('');
  const [revealReasonError, setRevealReasonError] = useState<string | null>(null);
  // Real-API reveal mutation. The host-event emission below still fires
  // so any local listeners (analytics, dev panel) see the bypass.
  const revealMutation = useRevealAuditEntry();

  const hasSensitiveFields =
    entry.ip !== undefined || entry.user_agent !== undefined || entry.payload !== undefined;
  const showSensitive = canReadSensitive && revealed;

  const actorName = users[entry.actor_id]?.name ?? entry.actor_id;
  const actorEmail = users[entry.actor_id]?.email;
  const absoluteTs = dayjs(entry.at).format('YYYY-MM-DD HH:mm:ss');
  const relativeTs = dayjs(entry.at).fromNow();

  const ipDisplay = !entry.ip ? null : showSensitive ? entry.ip : REDACTED;
  const uaDisplay = !entry.user_agent ? null : showSensitive ? entry.user_agent : REDACTED;

  function openReveal() {
    setRevealReason('');
    setRevealReasonError(null);
    setRevealModalOpen(true);
  }

  function confirmReveal() {
    const reason = revealReason.trim();
    if (reason.length < 4) {
      setRevealReasonError('Please provide a reason (minimum 4 characters).');
      return;
    }
    // Fire the real daemon reveal endpoint. The mutation persists the
    // follow-up audit row server-side; on failure we still emit the
    // host event so any local listeners record the bypass attempt.
    revealMutation.mutate(
      { tenant: entry.tenant_id ?? '', id: entry.id, data: { reason } },
      {
        onSettled: () => {
          emitHostEvent('audit:sensitive-revealed', {
            tenant_id: entry.tenant_id,
            entry_id: entry.id,
            reason,
            at: new Date().toISOString(),
          });
        },
      },
    );
    setRevealed(true);
    setRevealModalOpen(false);
    notify.success('Sensitive fields revealed', 'A new audit entry has been recorded.');
  }

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
    if (!showSensitive) {
      return JSON.stringify({ payload: REDACTED }, null, 2);
    }
    try {
      return JSON.stringify(entry.payload, null, 2);
    } catch {
      return null;
    }
  }, [entry.payload, showSensitive]);

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
        {canReadSensitive && hasSensitiveFields && !revealed && (
          <Button
            size="xs"
            variant="light"
            color="violet"
            leftSection={<IconEye size={12} />}
            onClick={openReveal}
            data-testid="audit-reveal-sensitive"
          >
            Reveal sensitive
          </Button>
        )}
      </Group>

      <Modal
        opened={revealModalOpen}
        onClose={() => {
          setRevealModalOpen(false);
        }}
        title="Reveal sensitive fields"
        transitionProps={{ duration: 0 }}
        data-testid="audit-reveal-modal"
      >
        <Stack gap="sm">
          <Text size="sm">
            Revealing sensitive fields (IP address, user-agent, request payload) records a new audit
            entry on this tenant. Provide a justification for compliance review.
          </Text>
          <Textarea
            label="Reason"
            placeholder="e.g. Investigating security incident #1234"
            minRows={3}
            required
            value={revealReason}
            onChange={(e) => {
              setRevealReason(e.currentTarget.value);
              setRevealReasonError(null);
            }}
            error={revealReasonError}
            data-testid="audit-reveal-reason"
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                setRevealModalOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              color="violet"
              size="sm"
              onClick={confirmReveal}
              data-testid="audit-reveal-confirm"
            >
              Reveal & record
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
