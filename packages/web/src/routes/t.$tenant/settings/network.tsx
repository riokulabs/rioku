/**
 * Network settings — /t/$tenant/settings/network.
 *
 * Listen addresses, HTTP3 toggle, Caddy JSON config overrides (Monaco editor),
 * and upstream timeouts. PUT to /api/v1/t/:tenant/settings/network.
 * After persist, the daemon invokes caddy.Reload() (wired at stage-2 daemon).
 * Wraps the <NetworkSection> component built in stage-1 plan 8b.
 *
 * Guard: network:read (readers see disabled form; writers can mutate).
 *
 * Plan 7 — Task 4
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Anchor, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { NetworkSection } from '@/features/settings/sections/network';

function NetworkSettingsPage() {
  const { tenant } = useParams({ strict: false });
  const tenantSlug = useMockStore((s) => s.tenants[s.currentTenantId ?? '']?.slug ?? tenant);

  return (
    <Stack gap="md" p="md" data-testid="settings-network-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="settings-network-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>
      <NetworkSection />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/network')({
  beforeLoad: requirePermissions({ required: ['network:read'] }),
  component: NetworkSettingsPage,
});
