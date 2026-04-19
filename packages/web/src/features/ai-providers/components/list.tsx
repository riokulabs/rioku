/**
 * <ProviderList> — DataTable list of AI providers for a tenant.
 *
 * Columns: name/description, kind badge, base_url (monospace truncated),
 * credential prefix chip, model count, enabled Switch, actions menu.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Badge,
  Text,
  Stack,
  Group,
  Menu,
  ActionIcon,
  Switch,
} from '@mantine/core';
import {
  IconDots,
  IconPencil,
  IconTrash,
  IconPlugConnected,
  IconRobot,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { ProviderKindBadge } from '@/features/ai-shared';
import { useProviderList, updateProvider } from '../api';
import type { AiProvider, ProviderFilter } from '../types';

interface ProviderListProps {
  tenantId: string;
  filter: ProviderFilter;
  onSelect: (provider: AiProvider) => void;
  onEdit: (provider: AiProvider) => void;
  onDelete: (provider: AiProvider) => void;
  onTest: (provider: AiProvider) => void;
}

export function ProviderList({
  tenantId,
  filter,
  onSelect,
  onEdit,
  onDelete,
  onTest,
}: ProviderListProps) {
  const providers = useProviderList(tenantId, filter);

  const columns = useMemo<ColumnDef<AiProvider>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500} ff="monospace">
                {p.name}
              </Text>
              {p.description && (
                <Text
                  size="xs"
                  c="var(--mantine-color-gray-7)"
                  lineClamp={1}
                  title={p.description}
                >
                  {p.description}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'kind',
        header: 'Kind',
        size: 120,
        accessorFn: (row) => row.kind,
        cell: ({ row }) => <ProviderKindBadge kind={row.original.kind} />,
      },
      {
        id: 'base_url',
        header: 'Base URL',
        accessorFn: (row) => row.base_url,
        cell: ({ row }) => (
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)" truncate>
            {row.original.base_url}
          </Text>
        ),
      },
      {
        id: 'credential',
        header: 'Credential',
        size: 160,
        accessorFn: (row) => row.credential_ref.prefix,
        cell: ({ row }) => (
          <Badge size="xs" variant="outline" color="gray" ff="monospace">
            {row.original.credential_ref.prefix}…
          </Badge>
        ),
      },
      {
        id: 'models',
        header: 'Models',
        size: 90,
        accessorFn: (row) => row.models.length,
        cell: ({ getValue }) => (
          <Text size="sm">{String(getValue<number>())}</Text>
        ),
      },
      {
        id: 'enabled',
        header: 'Enabled',
        size: 100,
        accessorFn: (row) => row.enabled,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <Switch
              checked={p.enabled}
              aria-label={`Toggle ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onChange={(e) => {
                void updateProvider(p.id, { enabled: e.currentTarget.checked });
              }}
            />
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <Menu shadow="md" width={180} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${p.name}`}
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
                    onEdit(p);
                  }}
                >
                  Edit
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconPlugConnected size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTest(p);
                  }}
                >
                  Test connection
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p);
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
    [onEdit, onTest, onDelete],
  );

  return (
    <DataTable
      data={providers}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="ai-providers"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconRobot}
          title="No providers"
          description="Connect an LLM provider to power your agents."
        />
      }
      caption="AI Providers"
    />
  );
}
