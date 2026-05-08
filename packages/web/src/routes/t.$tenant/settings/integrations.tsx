/**
 * Integrations settings — /t/$tenant/settings/integrations.
 *
 * Webhook endpoints list (name, path, enabled toggle), add/update/delete via
 * mock store hooks, and a webhook test-send button. OAuth connector cards
 * are gated behind the `integrationsOAuth` feature flag (stage-2+).
 *
 * Wraps the <IntegrationsSection> component built in stage-1 plan 8c.
 *
 * Guard: integrations:read (readers see list; writers can create/edit/delete).
 *
 * Plan 7 — Task 8
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Anchor, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { IntegrationsRealSection } from '@/features/settings/sections-real/integrations-real';

function IntegrationsSettingsPage() {
  const { tenant } = useParams({ strict: false });
  const tenantSlug = tenant ?? '';
  const activeTenant: string = tenantSlug;

  return (
    <Stack gap="md" p="md" data-testid="settings-integrations-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="settings-integrations-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>
      <IntegrationsRealSection tenant={activeTenant} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/integrations')({
  beforeLoad: requirePermissions({ required: ['integrations:read'] }),
  component: IntegrationsSettingsPage,
});
