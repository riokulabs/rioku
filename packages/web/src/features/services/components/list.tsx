/**
 * <ServiceList> — DataTable list of services for a tenant.
 *
 * Columns: name/description, upstream (protocol + URL), env, health, route
 * count, tags (chips, +N more), last reloaded, actions menu. Row click invokes
 * `onSelect` so the parent can open a drawer.
 */
import { useMemo, useCallback } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Stack, Group, Menu, ActionIcon } from '@mantine/core';
import {
  IconDots,
  IconRefresh,
  IconPencil,
  IconTrash,
  IconServer,
  IconPlayerPlay,
  IconPlayerPause,
  IconDownload,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { DataTable, type BulkAction } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { notify } from '@/hooks/use-notify';
import { useMockStore } from '@/api/mock-store';
import { HealthChip, ProtocolBadge } from '@/features/api-mgmt-shared';
import { useServiceList, deleteService, enableService, disableService } from '../api';
import type { Service, ServiceFilter } from '../types';

dayjs.extend(relativeTime);

const MAX_TAGS_SHOWN = 3;

interface ServiceListProps {
  tenantId: string;
  filter: ServiceFilter;
  onSelect: (service: Service) => void;
  onEdit: (service: Service) => void;
  onDelete: (service: Service) => void;
  onForceReload: (service: Service) => void;
}

export function ServiceList({
  tenantId,
  filter,
  onSelect,
  onEdit,
  onDelete,
  onForceReload,
}: ServiceListProps) {
  const services = useServiceList(tenantId, filter);
  const routes = useMockStore((s) => s.routes);

  // Derive per-service route count outside the selector (stable selector rule).
  const routeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const route of Object.values(routes)) {
      counts[route.service_id] = (counts[route.service_id] ?? 0) + 1;
    }
    return counts;
  }, [routes]);

  const handleBulkDelete = useCallback(async (ids: string[]) => {
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteService(id);
      } catch {
        failed++;
      }
    }
    const succeeded = ids.length - failed;
    if (succeeded > 0) {
      notify.success(
        'Services deleted',
        `${String(succeeded)} service${succeeded !== 1 ? 's' : ''} deleted.`,
      );
    }
    if (failed > 0) {
      notify.error(
        'Some deletions failed',
        `${String(failed)} service${failed !== 1 ? 's' : ''} could not be deleted (may have attached routes).`,
      );
    }
  }, []);

  const handleBulkEnable = useCallback(async (ids: string[]) => {
    let failed = 0;
    for (const id of ids) {
      try {
        await enableService(id);
      } catch {
        failed++;
      }
    }
    const succeeded = ids.length - failed;
    if (succeeded > 0) {
      notify.success(
        'Services enabled',
        `${String(succeeded)} service${succeeded !== 1 ? 's' : ''} enabled.`,
      );
    }
    if (failed > 0) {
      notify.error(
        'Some enables failed',
        `${String(failed)} service${failed !== 1 ? 's' : ''} could not be enabled.`,
      );
    }
  }, []);

  const handleBulkDisable = useCallback(async (ids: string[]) => {
    let failed = 0;
    for (const id of ids) {
      try {
        await disableService(id);
      } catch {
        failed++;
      }
    }
    const succeeded = ids.length - failed;
    if (succeeded > 0) {
      notify.success(
        'Services disabled',
        `${String(succeeded)} service${succeeded !== 1 ? 's' : ''} disabled.`,
      );
    }
    if (failed > 0) {
      notify.error(
        'Some disables failed',
        `${String(failed)} service${failed !== 1 ? 's' : ''} could not be disabled.`,
      );
    }
  }, []);

  const handleBulkExportJson = useCallback(
    (ids: string[]) => {
      const state = useMockStore.getState();
      const selected = ids
        .map((id) => state.services[id])
        .filter((s): s is NonNullable<typeof s> => s !== undefined)
        .map(({ id, name, upstream, upstream_protocol, env, health, tags, description }) => ({
          id,
          name,
          upstream,
          upstream_protocol,
          env,
          health,
          tags,
          ...(description !== undefined ? { description } : {}),
        }));
      const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `services-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notify.success('Export ready', `${String(selected.length)} service${selected.length !== 1 ? 's' : ''} exported.`);
    },
    [],
  );

  const bulkActions = useMemo<BulkAction[]>(
    () => [
      {
        label: 'Enable selected',
        color: 'green',
        icon: IconPlayerPlay,
        onClick: (ids) => {
          void handleBulkEnable(ids);
        },
      },
      {
        label: 'Disable selected',
        color: 'orange',
        icon: IconPlayerPause,
        onClick: (ids) => {
          void handleBulkDisable(ids);
        },
      },
      {
        label: 'Export as JSON',
        color: 'blue',
        icon: IconDownload,
        onClick: (ids) => {
          handleBulkExportJson(ids);
        },
      },
      {
        label: 'Delete selected',
        color: 'red',
        onClick: (ids) => {
          void handleBulkDelete(ids);
        },
      },
    ],
    [handleBulkEnable, handleBulkDisable, handleBulkExportJson, handleBulkDelete],
  );

  const columns = useMemo<ColumnDef<Service>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => {
          const svc = row.original;
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500} ff="monospace">
                {svc.name}
              </Text>
              {svc.description && (
                <Text
                  size="xs"
                  c="var(--mantine-color-gray-7)"
                  lineClamp={1}
                  title={svc.description}
                >
                  {svc.description}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'upstream',
        header: 'Upstream',
        accessorFn: (row) => row.upstream,
        cell: ({ row }) => {
          const svc = row.original;
          return (
            <Group gap="xs" wrap="nowrap">
              <ProtocolBadge kind={svc.upstream_protocol} />
              <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)" truncate>
                {svc.upstream}
              </Text>
            </Group>
          );
        },
      },
      {
        id: 'env',
        header: 'Env',
        size: 120,
        accessorFn: (row) => row.env,
        cell: ({ getValue }) => (
          <Badge size="sm" variant="outline" color="blue">
            {getValue<string>()}
          </Badge>
        ),
      },
      {
        id: 'health',
        header: 'Health',
        size: 120,
        accessorFn: (row) => row.health,
        cell: ({ row }) => <HealthChip status={row.original.health} />,
      },
      {
        id: 'routes',
        header: 'Routes',
        size: 90,
        accessorFn: (row) => routeCounts[row.id] ?? 0,
        cell: ({ getValue }) => <Text size="sm">{String(getValue<number>())}</Text>,
      },
      {
        id: 'tags',
        header: 'Tags',
        size: 200,
        accessorFn: (row) => row.tags.join(','),
        cell: ({ row }) => {
          const tags = row.original.tags;
          const shown = tags.slice(0, MAX_TAGS_SHOWN);
          const extra = tags.length - shown.length;
          return (
            <Group gap={4}>
              {shown.map((tag) => (
                <Badge key={tag} size="xs" variant="light" color="gray">
                  {tag}
                </Badge>
              ))}
              {extra > 0 && (
                <Badge size="xs" variant="outline" color="gray">
                  +{String(extra)} more
                </Badge>
              )}
            </Group>
          );
        },
      },
      {
        id: 'last_reloaded',
        header: 'Last reloaded',
        size: 140,
        accessorFn: (row) => row.last_reloaded_at ?? '',
        cell: ({ row }) => {
          const when = row.original.last_reloaded_at;
          if (!when) {
            return (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                never
              </Text>
            );
          }
          return (
            <Text size="xs" title={new Date(when).toLocaleString()}>
              {dayjs(when).fromNow()}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        cell: ({ row }) => {
          const svc = row.original;
          return (
            <Menu shadow="md" width={180} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${svc.name}`}
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
                    onEdit(svc);
                  }}
                >
                  Edit
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconRefresh size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onForceReload(svc);
                  }}
                >
                  Force reload
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(svc);
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
    [routeCounts, onEdit, onForceReload, onDelete],
  );

  return (
    <DataTable
      data={services}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="services"
      onRowClick={onSelect}
      rowSelection="multiple"
      bulkActions={bulkActions}
      emptyState={
        <EmptyState
          icon={IconServer}
          title="No services"
          description="Create your first service to route traffic to an upstream."
        />
      }
      caption="Services"
    />
  );
}
