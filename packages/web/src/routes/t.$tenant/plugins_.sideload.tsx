/**
 * /t/$tenant/plugins/sideload — Plan 09 T5.
 *
 * Operator uploads a built plugin archive + manifest. The daemon endpoint
 * is currently a 501 stub; the form's failure-mode UX renders the daemon's
 * problem-detail explanation inline so the operator understands the gap.
 *
 * Guard: plugin:install (mirrors the daemon-side RequirePermission check).
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Anchor, Breadcrumbs, Stack, Title } from '@mantine/core';
import { requirePermissions } from '@/hooks/use-before-load';
import { useMockStore } from '@/api/mock-store';
import { PluginSideloadForm } from '@/features/plugins/sideload';

function PluginSideloadPage() {
  const { tenant } = Route.useParams();
  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantSlug = tenantRecord?.slug ?? tenant;

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
      <PluginSideloadForm tenantSlug={tenantSlug} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/plugins_/sideload')({
  beforeLoad: requirePermissions({ required: ['plugin:install'] }),
  component: PluginSideloadPage,
});
