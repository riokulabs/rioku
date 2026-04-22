/**
 * <PkiSection> — settings PKI section.
 *
 * Renders:
 *   1. Certificate Authorities list (with create CA modal)
 *   2. Certificate Enrollments list (with request enrollment modal + revoke flow)
 *
 * Requires `pki:read` for visibility; `pki:write` gates write actions.
 *
 * Task 8b.7
 */
import { Alert, Stack } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { usePermission } from '@/hooks/use-permission';
import { useCurrentTenant } from '../api';
import { PkiCaList } from './pki-ca-list';
import { PkiEnrollmentList } from './pki-enrollment-list';

// ─── Component ────────────────────────────────────────────────────────────────

export function PkiSection() {
  const canRead = usePermission('pki:read');
  const canWrite = usePermission('pki:write');
  const tenant = useCurrentTenant();

  if (!canRead) {
    return (
      <Alert
        icon={<IconLock size={16} />}
        color="orange"
        variant="light"
        title="Access denied"
        data-testid="pki-access-denied"
      >
        You need the <strong>pki:read</strong> permission to view PKI settings.
      </Alert>
    );
  }

  if (!tenant) {
    return null;
  }

  return (
    <Stack gap="xl" data-testid="pki-section">
      <PkiCaList tenantId={tenant.id} canWrite={canWrite} />
      <PkiEnrollmentList tenantId={tenant.id} canWrite={canWrite} />
    </Stack>
  );
}
