/**
 * <MiddlewareList> — DataTable of middlewares for a tenant.
 *
 * Columns: kind badge, name + description, enabled Switch, order_hint, and a
 * referencing-routes count. Row click → onSelect (opens detail drawer).
 */
import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  ActionIcon,
  Badge,
  Menu,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import {
  IconDots,
  IconPencil,
  IconTrash,
  IconStack,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { notify } from '@/hooks/use-notify';
import { useMockStore } from '@/api/mock-store';
import { useMiddlewareList, updateMiddleware } from '../api';
import type { Middleware, MiddlewareFilter } from '../types';

const KIND_COLORS: Record<Middleware['kind'], string> = {
  'rate-limit': 'cyan',
  auth: 'red',
  transform: 'violet',
  cors: 'orange',
  cache: 'green',
  logging: 'gray',
  custom: 'grape',
};

interface MiddlewareListProps {
  tenantId: string;
  filter: MiddlewareFilter;
  onSelect: (m: Middleware) => void;
  onEdit: (m: Middleware) => void;
  onDelete: (m: Middleware) => void;
}

export function MiddlewareList({
  tenantId,
  filter,
  onSelect,
  onEdit,
  onDelete,
}: MiddlewareListProps) {
  const middlewares = useMiddlewareList(tenantId, filter);
  const routes = useMockStore((s) => s.routes);

  // Derive "referenced by" count outside the selector.
  const refCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const route of Object.values(routes)) {
      for (const mid of route.middleware_ids) {
        counts[mid] = (counts[mid] ?? 0) + 1;
      }
    }
    return counts;
  }, [routes]);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleToggle(m: Middleware, next: boolean) {
    setTogglingId(m.id);
    try {
      await updateMiddleware(m.id, { enabled: next });
      notify.success(
        next ? 'Middleware enabled' : 'Middleware disabled',
        `${m.name} is now ${next ? 'active' : 'inactive'}.`,
      );
    } catch {
      notify.error('Failed to toggle middleware', 'Please try again.');
    } finally {
      setTogglingId(null);
    }
  }

  const columns = useMemo<ColumnDef<Middleware>[]>(
    () => [
      {
        id: 'kind',
        header: 'Kind',
        size: 120,
        accessorFn: (row) => row.kind,
        cell: ({ row }) => (
          <Badge size="sm" variant="light" color={KIND_COLORS[row.original.kind]}>
            {row.original.kind}
          </Badge>
        ),
      },
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500}>
                {m.name}
              </Text>
              {m.description && (
                <Text
                  size="xs"
                  c="var(--mantine-color-gray-7)"
                  lineClamp={1}
                  title={m.description}
                >
                  {m.description}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'enabled',
        header: 'Enabled',
        size: 100,
        accessorFn: (row) => row.enabled,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <Switch
              checked={m.enabled}
              disabled={togglingId === m.id}
              aria-label={m.enabled ? `Disable ${m.name}` : `Enable ${m.name}`}
              onChange={(e) => {
                e.stopPropagation();
                void handleToggle(m, e.currentTarget.checked);
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            />
          );
        },
      },
      {
        id: 'order_hint',
        header: 'Order',
        size: 90,
        accessorFn: (row) => row.order_hint,
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace">
            {String(getValue<number>())}
          </Text>
        ),
      },
      {
        id: 'referenced',
        header: 'Referenced by',
        size: 140,
        accessorFn: (row) => refCounts[row.id] ?? 0,
        cell: ({ getValue }) => {
          const n = getValue<number>();
          return (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {String(n)} route{n === 1 ? '' : 's'}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <Menu shadow="md" width={160} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${m.name}`}
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
                    onEdit(m);
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
                    onDelete(m);
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
    [refCounts, togglingId, onEdit, onDelete],
  );

  return (
    <DataTable
      data={middlewares}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="middlewares"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconStack}
          title="No middlewares"
          description="Create a middleware to apply it to routes."
        />
      }
      caption="Middlewares"
    />
  );
}
