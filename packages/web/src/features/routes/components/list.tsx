/**
 * <RouteList> — DataTable of routes, optionally scoped to a single service.
 *
 * Columns: name, method Badge, path (monospace), match_kind chip, enabled
 * Switch, policy count, middleware count, actions menu.
 */
import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { ActionIcon, Badge, Group, Menu, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconDots, IconPencil, IconSearch, IconTrash, IconRoute } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { notify } from '@/hooks/use-notify';
import { useRouteList, updateRoute } from '../api';
import type { Route, RouteFilter } from '../types';

const METHOD_COLORS: Record<Route['method'], string> = {
  GET: 'blue',
  POST: 'green',
  PUT: 'orange',
  PATCH: 'yellow',
  DELETE: 'red',
  ANY: 'gray',
};

const MATCH_KIND_COLORS: Record<Route['match_kind'], string> = {
  prefix: 'blue',
  exact: 'green',
  regex: 'violet',
};

interface RouteListProps {
  /** If supplied, list is scoped to this service. Otherwise all tenant routes. */
  serviceId?: string;
  tenantId: string;
  filter: RouteFilter;
  onSelect: (route: Route) => void;
  onEdit: (route: Route) => void;
  onDelete: (route: Route) => void;
}

export function RouteList({
  serviceId,
  tenantId,
  filter,
  onSelect,
  onEdit,
  onDelete,
}: RouteListProps) {
  const routes = useRouteList(serviceId, tenantId, filter);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filteredRoutes = useMemo(() => {
    if (!search.trim()) return routes;
    const q = search.toLowerCase();
    return routes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q),
    );
  }, [routes, search]);

  async function handleToggle(route: Route, next: boolean) {
    setTogglingId(route.id);
    try {
      await updateRoute(route.id, { enabled: next });
      notify.success(
        next ? 'Route enabled' : 'Route disabled',
        `${route.name} is now ${next ? 'active' : 'inactive'}.`,
      );
    } catch {
      notify.error('Failed to toggle route', 'Please try again.');
    } finally {
      setTogglingId(null);
    }
  }

  const columns = useMemo<ColumnDef<Route>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <Text size="sm" fw={500}>
            {row.original.name}
          </Text>
        ),
      },
      {
        id: 'method',
        header: 'Method',
        size: 110,
        accessorFn: (row) => row.method,
        cell: ({ row }) => (
          <Badge size="sm" variant="light" color={METHOD_COLORS[row.original.method]}>
            {row.original.method}
          </Badge>
        ),
      },
      {
        id: 'path',
        header: 'Path',
        accessorFn: (row) => row.path,
        cell: ({ row }) => (
          <Text size="xs" ff="monospace" truncate title={row.original.path}>
            {row.original.path}
          </Text>
        ),
      },
      {
        id: 'match_kind',
        header: 'Match',
        size: 110,
        accessorFn: (row) => row.match_kind,
        cell: ({ row }) => (
          <Badge size="xs" variant="outline" color={MATCH_KIND_COLORS[row.original.match_kind]}>
            {row.original.match_kind}
          </Badge>
        ),
      },
      {
        id: 'enabled',
        header: 'Enabled',
        size: 100,
        accessorFn: (row) => row.enabled,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Switch
              checked={r.enabled}
              disabled={togglingId === r.id}
              aria-label={r.enabled ? `Disable ${r.name}` : `Enable ${r.name}`}
              onChange={(e) => {
                e.stopPropagation();
                void handleToggle(r, e.currentTarget.checked);
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            />
          );
        },
      },
      {
        id: 'policies',
        header: 'Policies',
        size: 90,
        accessorFn: (row) => row.policies.length,
        cell: ({ getValue }) => <Text size="sm">{String(getValue<number>())}</Text>,
      },
      {
        id: 'middlewares',
        header: 'Middlewares',
        size: 110,
        accessorFn: (row) => row.middleware_ids.length,
        cell: ({ getValue }) => <Text size="sm">{String(getValue<number>())}</Text>,
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Menu shadow="md" width={160} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${r.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconPencil size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(r);
                  }}
                >
                  Edit
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(r);
                  }}
                >
                  Delete…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          );
        },
      },
    ],
    [togglingId, onEdit, onDelete],
  );

  return (
    <Stack gap="sm">
      <Group gap="sm">
        <TextInput
          leftSection={<IconSearch size={16} />}
          placeholder="Search routes…"
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
          }}
          style={{ flex: 1 }}
          aria-label="Search routes"
        />
      </Group>
      <DataTable
        data={filteredRoutes}
        columns={columns}
        sorting
        pagination={{ pageSize: 20 }}
        urlSyncKey="routes"
        onRowClick={onSelect}
        emptyState={
          <Stack align="center">
            <EmptyState
              icon={IconRoute}
              title="No routes"
              description="Create a route to forward traffic to a service."
            />
          </Stack>
        }
        caption="Routes"
      />
    </Stack>
  );
}
