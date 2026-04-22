/**
 * <ObservabilitySection> — settings Observability section.
 *
 * Renders four subsections, each with its own permission guard:
 *   1. Metrics  — scrape endpoint + retention (metrics:write)
 *   2. Logs     — per-component levels + format + rotation (logs:write)
 *   3. Traces   — retention + sample rate (traces:write)
 *   4. Audit retention — reuses <RetentionConfigForm> from Plan 5 (audit:retention:write)
 *
 * A top-level metrics:read check gates the whole section for visibility.
 *
 * Task 8b.9
 */
import { Alert, Divider, Stack, Title } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { usePermission } from '@/hooks/use-permission';
import { RetentionConfigForm } from '@/features/audit';
import { useCurrentTenant } from '../api';
import { ObservabilityMetrics } from './observability-metrics';
import { ObservabilityLogs } from './observability-logs';
import { ObservabilityTraces } from './observability-traces';

// ─── Component ────────────────────────────────────────────────────────────────

export function ObservabilitySection() {
  const canReadMetrics = usePermission('metrics:read');
  const canWriteMetrics = usePermission('metrics:write');
  const canWriteLogs = usePermission('logs:write');
  const canWriteTraces = usePermission('traces:write');
  const tenant = useCurrentTenant();

  // Gate entire section on metrics:read as a proxy for "can see observability".
  if (!canReadMetrics) {
    return (
      <Alert
        icon={<IconLock size={16} />}
        color="orange"
        variant="light"
        title="Access denied"
        data-testid="observability-access-denied"
      >
        You need the <strong>metrics:read</strong> permission to view Observability settings.
      </Alert>
    );
  }

  if (!tenant) {
    return null;
  }

  return (
    <Stack gap="xl" data-testid="observability-section">
      <ObservabilityMetrics tenantId={tenant.id} canWrite={canWriteMetrics} />
      <Divider />
      <ObservabilityLogs tenantId={tenant.id} canWrite={canWriteLogs} />
      <Divider />
      <ObservabilityTraces tenantId={tenant.id} canWrite={canWriteTraces} />
      <Divider />
      <Stack gap="sm" data-testid="observability-audit-retention">
        <Title order={5}>Audit retention</Title>
        <RetentionConfigForm tenantId={tenant.id} />
      </Stack>
    </Stack>
  );
}
