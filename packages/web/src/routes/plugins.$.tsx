/**
 * Catch-all route for plugin-registered routes.
 *
 * All plugin routes live under /plugins/* — plugins call
 * `host.routes.register({ path: '/plugins/my-plugin/page', component: MyPage })`
 * and this catch-all looks up the matched path against the registry and renders
 * the corresponding component.
 *
 * Stage-1 limitation: plugins cannot register routes at arbitrary first-party
 * paths (e.g. /t/$tenant/my-feature). All plugin-registered routes must be
 * under /plugins/*.  This is a deliberate constraint — static first-party
 * routes are generated at build time; runtime registration only works here.
 *
 */

import { createFileRoute, useParams } from '@tanstack/react-router';
import { Stack, Title, Text, Alert } from '@mantine/core';
import { IconPlug, IconAlertCircle } from '@tabler/icons-react';
import { listPluginRoutes } from '@/host/routes';

// ─── Not-found page for unmatched plugin routes ───────────────────────────────

function PluginRouteNotFound({ path }: { path: string }) {
  return (
    <Stack gap="md" p="md">
      <Alert
        icon={<IconAlertCircle size={18} />}
        color="orange"
        variant="light"
        title="Plugin route not found"
      >
        No plugin has registered the route <strong>/plugins/{path}</strong>.
        <Text size="sm" mt={4}>
          If you expected a plugin to be available here, make sure it is installed and enabled.
        </Text>
      </Alert>
    </Stack>
  );
}

// ─── Plugin route renderer ────────────────────────────────────────────────────

function PluginRoutePage() {
  // TanStack Router splat param is `_splat` when using non-strict mode.
  // We cast via unknown to avoid the any linting issue while acknowledging
  // this is a runtime-typed value from the router.
  const params = useParams({ strict: false }) as unknown as { _splat?: string };
  const splatPath = params._splat ?? '';
  const fullPath = `/plugins/${splatPath}`;

  // Look up the plugin route registry for a matching path
  const routes = listPluginRoutes();
  const match = routes.find((r) => r.path === fullPath);

  if (!match) {
    return <PluginRouteNotFound path={splatPath} />;
  }

  const Component = match.component;

  return (
    <Stack gap="md" p="md">
      {/* Plugin attribution header */}
      <Stack gap={2}>
        <Title order={2} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconPlug size={20} />
          {match.pluginName ?? 'Plugin'}
        </Title>
        {match.pluginName && (
          <Text size="xs" c="dimmed">
            Provided by plugin: {match.pluginName}
          </Text>
        )}
      </Stack>

      {/* Plugin-rendered component */}
      <Component />
    </Stack>
  );
}

// The TanStack router-plugin requires the route id to be a plain string
// literal so its static analyser can emit this file into routeTree.gen.ts.
// The generated union refreshes on dev-server start and during `pnpm build`.
export const Route = createFileRoute('/plugins/$')({
  component: PluginRoutePage,
});
