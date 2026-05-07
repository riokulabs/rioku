/**
 * <RouteFullPage> — the full-page view for a single route.
 *
 * Layout: header (name, method, enabled, service) + Tabs:
 *   - Overview     — match info, headers, raw config preview
 *   - Middlewares  — drag-drop ordered stack (`MiddlewareStackEditor`)
 *   - Policies     — attached access-policies (`AttachedPolicies`)
 *   - Audit        — recent audit entries for this route
 *
 * Loaded by the route file `routes/t.$tenant/api-mgmt/routes.$routeId.tsx`.
 * Reads the route from the real Stage-2 endpoint via `useRouteDetail`; reads
 * the audit tail from the mock-store for now (audit is owned by Plan 05).
 */
import { useMemo } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Code,
  Divider,
  Group,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconHistory,
  IconRoute,
  IconShield,
  IconStack2,
  IconInfoCircle,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useMockStore } from '@/api/mock-store';
import { buildMatchPreview } from '@/features/api-mgmt-shared';
import { useRouteDetail } from '../api';
import { AttachedPolicies } from './attached-policies';
import { MiddlewareStackEditor } from './middleware-stack-editor';

interface RouteFullPageProps {
  tenantId: string;
  routeId: string;
  /** Called when the user clicks the breadcrumb back link. */
  onBack?: () => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'blue',
  POST: 'green',
  PUT: 'orange',
  PATCH: 'yellow',
  DELETE: 'red',
  ANY: 'gray',
};

export function RouteFullPage({ tenantId, routeId, onBack }: RouteFullPageProps) {
  const route = useRouteDetail(tenantId, routeId);
  // Audit tail still comes from the mock store; Plan 05 owns the real
  // audit endpoint and will swap this for a real query.
  const auditEntries = useMockStore((s) => s.audit);

  const auditTail = useMemo(() => {
    if (!route) return [];
    return auditEntries
      .filter((e) => e.resource_type === 'route' && e.resource_id === route.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 25);
  }, [auditEntries, route]);

  if (!route) {
    return (
      <Stack gap="md" p="lg" data-testid="route-fullpage-not-found">
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          Route not found.
        </Alert>
      </Stack>
    );
  }

  const matchPreview = buildMatchPreview(route.method, route.match_kind, route.path);

  return (
    <Stack gap="md" p="lg" data-testid="route-fullpage">
      <Breadcrumbs>
        {onBack ? (
          <Anchor component="button" type="button" onClick={onBack}>
            Routes
          </Anchor>
        ) : (
          <Text>Routes</Text>
        )}
        <Text>{route.name}</Text>
      </Breadcrumbs>

      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconRoute size={28} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={3}>{route.name}</Title>
              <Badge size="md" variant="light" color={METHOD_COLORS[route.method] ?? 'gray'}>
                {route.method}
              </Badge>
              <Badge size="md" variant="light" color={route.enabled ? 'green' : 'gray'}>
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

      <Tabs defaultValue="overview" keepMounted={false} data-testid="route-fullpage-tabs">
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconInfoCircle size={14} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="middlewares" leftSection={<IconStack2 size={14} />}>
            Middlewares
          </Tabs.Tab>
          <Tabs.Tab value="policies" leftSection={<IconShield size={14} />}>
            Policies
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        {/* Overview */}
        <Tabs.Panel value="overview" pt="md">
          <Stack gap="md">
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Match
              </Text>
              <Text size="xs" ff="monospace">
                {matchPreview}
              </Text>
              <Group gap="lg">
                <Group gap="xs">
                  <Text size="xs" c="var(--mantine-color-gray-7)">
                    Strip prefix:
                  </Text>
                  <Badge
                    size="xs"
                    variant="outline"
                    color={route.strip_prefix ? 'green' : 'gray'}
                  >
                    {route.strip_prefix ? 'yes' : 'no'}
                  </Badge>
                </Group>
                {route.rewrite_path && (
                  <Group gap="xs">
                    <Text size="xs" c="var(--mantine-color-gray-7)">
                      Rewrite path:
                    </Text>
                    <Text size="xs" ff="monospace">
                      {route.rewrite_path}
                    </Text>
                  </Group>
                )}
              </Group>
            </Stack>

            <Divider />

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Headers add
              </Text>
              {Object.keys(route.headers_add).length === 0 ? (
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  (none)
                </Text>
              ) : (
                <Stack gap={2}>
                  {Object.entries(route.headers_add).map(([k, v]) => (
                    <Code key={k}>{`${k}: ${v}`}</Code>
                  ))}
                </Stack>
              )}
            </Stack>

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Headers remove
              </Text>
              {route.headers_remove.length === 0 ? (
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  (none)
                </Text>
              ) : (
                <Code>{route.headers_remove.join(', ')}</Code>
              )}
            </Stack>
          </Stack>
        </Tabs.Panel>

        {/* Middlewares */}
        <Tabs.Panel value="middlewares" pt="md">
          <MiddlewareStackEditor routeId={route.id} tenantId={tenantId} />
        </Tabs.Panel>

        {/* Policies */}
        <Tabs.Panel value="policies" pt="md">
          <AttachedPolicies routeId={route.id} tenantId={tenantId} />
        </Tabs.Panel>

        {/* Audit */}
        <Tabs.Panel value="audit" pt="md">
          {auditTail.length === 0 ? (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              No audit entries for this route yet.
            </Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Action</Table.Th>
                  <Table.Th>Actor</Table.Th>
                  <Table.Th>When</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {auditTail.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {e.action}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{e.actor_id}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{dayjs(e.at).format('MMM D, HH:mm:ss')}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
