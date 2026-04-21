/**
 * <TlsSection> — settings TLS section.
 *
 * Renders:
 *   1. TLS certificate list (with upload modal)
 *   2. ACME configuration form
 *   3. Cipher suites configuration
 *
 * Requires `tls:read` for visibility; `tls:write` gates write actions.
 *
 * Task 8b.8
 */
import {
  Alert,
  Divider,
  Stack,
} from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { usePermission } from '@/hooks/use-permission';
import { useCurrentTenant } from '../api';
import { TlsCertList } from './tls-cert-list';
import { TlsAcmeConfig } from './tls-acme-config';
import { TlsCipherConfig } from './tls-cipher-config';

// ─── Component ────────────────────────────────────────────────────────────────

export function TlsSection() {
  const canRead = usePermission('tls:read');
  const canWrite = usePermission('tls:write');
  const tenant = useCurrentTenant();

  if (!canRead) {
    return (
      <Alert
        icon={<IconLock size={16} />}
        color="orange"
        variant="light"
        title="Access denied"
        data-testid="tls-access-denied"
      >
        You need the <strong>tls:read</strong> permission to view TLS settings.
      </Alert>
    );
  }

  if (!tenant) {
    return null;
  }

  return (
    <Stack gap="xl" data-testid="tls-section">
      <TlsCertList tenantId={tenant.id} canWrite={canWrite} />
      <Divider />
      <TlsAcmeConfig tenantId={tenant.id} canWrite={canWrite} />
      <Divider />
      <TlsCipherConfig tenantId={tenant.id} canWrite={canWrite} />
    </Stack>
  );
}
