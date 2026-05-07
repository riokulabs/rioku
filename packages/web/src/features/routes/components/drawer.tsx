/**
 * <RouteDrawer> — quick-info drawer content for a single route.
 *
 * This is intentionally lightweight (vs. the full `RouteDetail` component
 * which is the drawer body). It renders enough information to triage the
 * route at a glance — name, method, path, enabled state, service, policy
 * count, middleware count — and exposes a primary "Open full page" CTA
 * that navigates to the full-page route view.
 *
 * Used as the body of the routes-page drawer when the drawer-mode is
 * 'detail'. Heavier interactions (edit, delete confirm, drag-drop reorder)
 * live on the full page.
 */
import { Badge, Button, Divider, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconArrowsDiagonal, IconRoute } from '@tabler/icons-react';
import { Alert } from '@mantine/core';
import { buildMatchPreview } from '@/features/api-mgmt-shared';
import { useRouteDetail } from '../api';

interface RouteDrawerProps {
  routeId: string;
  tenantId: string;
  /** Called when the user clicks "Open full page". */
  onOpenFullPage: () => void;
  /** Called when the user clicks "Edit". */
  onEdit: () => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'blue',
  POST: 'green',
  PUT: 'orange',
  PATCH: 'yellow',
  DELETE: 'red',
  ANY: 'gray',
};

export function RouteDrawer({ routeId, tenantId, onOpenFullPage, onEdit }: RouteDrawerProps) {
  const route = useRouteDetail(tenantId, routeId);

  if (!route) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Route not found.
      </Alert>
    );
  }

  const matchPreview = buildMatchPreview(route.method, route.match_kind, route.path);

  return (
    <Stack gap="md" data-testid="route-drawer">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconRoute size={24} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4}>{route.name}</Title>
              <Badge size="sm" variant="light" color={METHOD_COLORS[route.method] ?? 'gray'}>
                {route.method}
              </Badge>
              <Badge size="sm" variant="light" color={route.enabled ? 'green' : 'gray'}>
                {route.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Service: {route.service_id}
            </Text>
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* Match summary */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Match
        </Text>
        <Text size="xs" ff="monospace">
          {matchPreview}
        </Text>
      </Stack>

      {/* Quick stats */}
      <Group gap="lg">
        <Stack gap={2}>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Attached policies
          </Text>
          <Text size="sm" fw={600}>
            {String(route.policies.length)}
          </Text>
        </Stack>
        <Stack gap={2}>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Middlewares
          </Text>
          <Text size="sm" fw={600}>
            {String(route.middleware_ids.length)}
          </Text>
        </Stack>
        <Stack gap={2}>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Strip prefix
          </Text>
          <Text size="sm" fw={600}>
            {route.strip_prefix ? 'yes' : 'no'}
          </Text>
        </Stack>
      </Group>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button
          size="sm"
          leftSection={<IconArrowsDiagonal size={14} />}
          onClick={onOpenFullPage}
          data-testid="route-drawer-open-full-page"
        >
          Open full page
        </Button>
        <Button size="sm" variant="default" onClick={onEdit}>
          Edit
        </Button>
      </Group>
    </Stack>
  );
}
