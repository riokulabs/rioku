/**
 * TLS settings — /t/$tenant/settings/tls.
 *
 * TLS certificate list (manual + auto-renew toggle + delete), ACME provider
 * configuration (Let's Encrypt / ZeroSSL / custom Pebble), allowed cipher
 * suites, and manual cert upload. Wraps the <TlsSection> component built
 * in stage-1 plan 8b.
 *
 * Guard: tls:read (readers see disabled form; writers can mutate).
 *
 * Plan 7 — Task 5
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Anchor, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { TlsRealSection } from '@/features/settings/sections-real/tls-real';

function TlsSettingsPage() {
  const { tenant } = useParams({ strict: false });
  const tenantSlug = tenant ?? "";
  const activeTenant: string = tenantSlug;

  return (
    <Stack gap="md" p="md" data-testid="settings-tls-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="settings-tls-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>
      <TlsRealSection tenant={activeTenant} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/tls')({
  beforeLoad: requirePermissions({ required: ['tls:read'] }),
  component: TlsSettingsPage,
});
