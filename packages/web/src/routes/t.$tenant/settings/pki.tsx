/**
 * PKI settings — /t/$tenant/settings/pki.
 *
 * Certificate Authority list, CA creation (internal/external), certificate
 * enrollment list, enrollment creation, and revocation. Wraps the <PkiSection>
 * component built in stage-1 plan 8b.
 *
 * Guard: pki:read (readers see list; writers can create/revoke).
 *
 * Plan 7 — Task 6
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Anchor, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { PkiRealSection } from '@/features/settings/sections-real/pki-real';

function PkiSettingsPage() {
  const { tenant } = useParams({ strict: false });
  const tenantSlug = tenant ?? '';
  const activeTenant: string = tenantSlug;

  return (
    <Stack gap="md" p="md" data-testid="settings-pki-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="settings-pki-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>
      <PkiRealSection tenant={activeTenant} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/pki')({
  beforeLoad: requirePermissions({ required: ['pki:read'] }),
  component: PkiSettingsPage,
});
