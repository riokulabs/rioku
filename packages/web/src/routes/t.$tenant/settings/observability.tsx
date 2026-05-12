/**
 * Observability settings — /t/$tenant/settings/observability.
 *
 * Metrics (scrape endpoint, auth, retention), logs (levels, format, rotation),
 * and traces (retention, sample rate) configuration. PUT to:
 *   /api/v1/t/:tenant/settings/observability/{metrics,logs,traces}
 *
 * Live metrics preview uses the daemon's /metrics endpoint directly (proxied
 * via the daemon's PromQL stub). Full PromQL support is planned.
 *
 * Wraps the <ObservabilitySection> component.
 *
 * Guard: tenant:read (all authenticated tenant members may view; write actions
 * require tenant:write, enforced inside the section component).
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Anchor, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { ObservabilityRealSection } from '@/features/settings/sections-real/observability-real';

function ObservabilitySettingsPage() {
  const { tenant } = useParams({ strict: false });
  const tenantSlug = tenant ?? '';
  const activeTenant: string = tenantSlug;

  return (
    <Stack gap="md" p="md" data-testid="settings-observability-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="settings-observability-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>
      <ObservabilityRealSection tenant={activeTenant} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/observability')({
  beforeLoad: requirePermissions({ required: ['tenant:read'] }),
  component: ObservabilitySettingsPage,
});
