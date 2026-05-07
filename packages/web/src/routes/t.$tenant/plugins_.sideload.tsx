/**
 * /t/$tenant/plugins/sideload — Plan 09 T5.
 *
 * Operator uploads a built plugin archive + manifest. Sideload is a
 * dev-mode-only feature: when the daemon's `sideload_enabled` flag is
 * off (the default), the page renders a "Not available in this build"
 * notice and the form is hidden. The daemon-side endpoint returns 404
 * in the same condition.
 *
 * Guard: plugin:install (mirrors the daemon-side RequirePermission
 * check) AND the daemon capability flag.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Alert, Anchor, Breadcrumbs, Stack, Title } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { PluginSideloadForm } from '@/features/plugins/sideload';
import { useDaemonCapabilities } from '@/features/plugins/use-daemon-capabilities';

function PluginSideloadPage() {
  const { tenant } = Route.useParams();
  const tenantSlug = tenant;
  const caps = useDaemonCapabilities();

  return (
    <Stack gap="md" p="md">
      <Breadcrumbs>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */}
        <Anchor component={Link as any} to="/t/$tenant/plugins" params={{ tenant: tenantSlug }}>
          Plugins
        </Anchor>
        <span>Sideload</span>
      </Breadcrumbs>
      <Title order={2}>Sideload a plugin</Title>
      {caps.sideloadEnabled ? (
        <PluginSideloadForm tenantSlug={tenantSlug} />
      ) : (
        <Alert
          icon={<IconInfoCircle />}
          color="yellow"
          title="Not available in this build"
          aria-label="sideload-disabled"
        >
          Plugin sideload is a development-mode-only feature and is disabled on
          this daemon. Set <code>RIOKU_SIDELOAD_ENABLED=1</code> (or
          <code> daemon.sideload_enabled: true</code> in <code>rioku.yaml</code>)
          to enable it. Production deployments should install plugins via the
          marketplace or the build service instead.
        </Alert>
      )}
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/plugins_/sideload')({
  beforeLoad: requirePermissions({ required: ['plugin:install'] }),
  component: PluginSideloadPage,
});
