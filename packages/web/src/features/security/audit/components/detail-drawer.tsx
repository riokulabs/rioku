/**
 * <AuditEntryDetail> — drawer showing full details for a single audit entry.
 *
 * Renders:
 *   - Metadata (timestamp, actor, tenant, session, IP, user-agent, outcome, tier)
 *   - Payload via <CodeBlock language="json">
 *   - Diff via <DiffView> when entry.diff is present
 *   - Impersonation banner when acted_as_admin is true
 */
import {
  Stack,
  Text,
  Group,
  Badge,
  Alert,
  Divider,
  Box,
} from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';
import { CodeBlock } from '@/components/code-block';
import { DiffView } from '@/components/diff-view';
import { IdBadge } from '@/components/id-badge';
import type { AuditEntryWithContext } from '../types';
import { Zone } from '@/components/zone';

// ── Color helpers ─────────────────────────────────────────────────────────────

const OUTCOME_COLOR: Record<string, string> = {
  success: 'green',
  denied: 'orange',
  error: 'red',
};

const TIER_COLOR: Record<string, string> = {
  read: 'blue',
  'read-sensitive': 'violet',
  write: 'yellow',
  destructive: 'red',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface AuditEntryDetailProps {
  entry: AuditEntryWithContext;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuditEntryDetail({ entry }: AuditEntryDetailProps) {
  const ts = new Date(entry.at);
  const tsAbsolute = ts.toLocaleString();

  return (
    <Stack gap="md" data-testid="audit-entry-detail">
      {/* ── Impersonation banner ───────────────────────────────────────── */}
      {entry.acted_as_admin && (
        <Alert
          icon={<IconShieldLock size={16} />}
          color="orange"
          variant="light"
          title="Acted as super-admin"
          data-testid="impersonation-banner"
        >
          This action was performed by a super-admin during an impersonation
          session.
          {entry.impersonation_session_id && (
            <Box mt={4} component="div">
              <Text size="xs" component="span">Session: </Text>
              <IdBadge id={entry.impersonation_session_id} />
            </Box>
          )}
        </Alert>
      )}

      {/* ── Metadata ──────────────────────────────────────────────────── */}
      <Stack gap={6}>
        <MetaRow label="Time" value={tsAbsolute} />
        <MetaRow label="Actor" value={entry.actor_name} />
        {entry.tenant_id && (
          <MetaRow label="Tenant" value={<IdBadge id={entry.tenant_id} />} />
        )}
        {entry.impersonation_session_id && !entry.acted_as_admin && (
          <MetaRow
            label="Session"
            value={<IdBadge id={entry.impersonation_session_id} />}
          />
        )}
        <MetaRow label="Action" value={<Text ff="monospace" size="sm">{entry.action}</Text>} />
        <MetaRow label="Resource type" value={entry.resource_type} />
        {entry.resource_id && (
          <MetaRow label="Resource ID" value={<IdBadge id={entry.resource_id} />} />
        )}
        <MetaRow
          label="Outcome"
          value={
            <Badge size="sm" color={OUTCOME_COLOR[entry.outcome] ?? 'gray'} variant="light">
              {entry.outcome}
            </Badge>
          }
        />
        <MetaRow
          label="Tier"
          value={
            <Badge size="sm" color={TIER_COLOR[entry.tier] ?? 'gray'} variant="outline">
              {entry.tier}
            </Badge>
          }
        />
      </Stack>

      {/* ── Payload ───────────────────────────────────────────────────── */}
      {entry.payload !== undefined && (
        <>
          <Divider label="Payload" labelPosition="left" />
          <CodeBlock
            code={JSON.stringify(entry.payload, null, 2)}
            language="json"
            title="payload"
            maxHeight={300}
          />
        </>
      )}

      {/* ── Diff ──────────────────────────────────────────────────────── */}
      {entry.diff && (
        <>
          <Divider label="Diff" labelPosition="left" />
          <DiffView
            before={entry.diff.before}
            after={entry.diff.after}
            label="Field changes"
          />
        </>
      )}

      {/* Zone: audit.entry.footer — plugins can append actions or metadata */}
      <Zone id="audit.entry.footer" />
    </Stack>
  );
}

// ── MetaRow helper ────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group gap="xs" align="flex-start">
      <Box style={{ minWidth: 110 }}>
        <Text size="xs" c="dimmed" fw={500}>
          {label}
        </Text>
      </Box>
      {typeof value === 'string' ? (
        <Text size="sm">{value}</Text>
      ) : (
        value
      )}
    </Group>
  );
}
