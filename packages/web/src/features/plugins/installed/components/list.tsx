/**
 * <InstalledPluginList> — DataTable of installed plugins.
 *
 * Columns: name (with verified/errors badges), version, parts chips, enabled
 * switch, actions menu.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Badge,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Menu,
  ActionIcon,
  Alert,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconDots,
  IconInfoCircle,
  IconPlug,
  IconSearch,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useFilterUrlHandle } from '@/hooks/use-filter-url-handle';
import { notify } from '@/hooks/use-notify';
import { PART_COLORS } from '../../shared/constants';
import { useInstalledPluginList, enablePlugin, disablePlugin } from '../api';
import type { InstalledPluginFilter, Plugin } from '../types';

const ENABLED_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
];

const DEFAULT_FILTER: InstalledPluginFilter = { search: '', enabled: 'all' };

interface InstalledPluginListProps {
  tenantId: string;
  onSelect: (plugin: Plugin) => void;
  onUninstall: (plugin: Plugin) => void;
}

export function InstalledPluginList({ tenantId, onSelect, onUninstall }: InstalledPluginListProps) {
  const { filter, setFilter } = useFilterUrlHandle<InstalledPluginFilter>(DEFAULT_FILTER);

  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Commit debounced search input to the opaque filter; typing stays snappy
  // while the list query only refetches after the user pauses.
  useEffect(() => {
    if (filter.search !== debouncedSearch) {
      setFilter({ ...filter, search: debouncedSearch });
    }
  }, [debouncedSearch, filter, setFilter]);

  const handleEnabledChange = useCallback(
    (value: string | null) => {
      setFilter({
        ...filter,
        enabled: (value ?? 'all') as InstalledPluginFilter['enabled'],
      });
    },
    [filter, setFilter],
  );

  const plugins = useInstalledPluginList(tenantId, filter);

  async function handleToggle(plugin: Plugin, next: boolean) {
    setTogglingId(plugin.id);
    try {
      if (next) {
        await enablePlugin(plugin.id, tenantId);
        notify.success('Plugin enabled', `${plugin.display_name} is now active.`);
      } else {
        await disablePlugin(plugin.id, tenantId);
        notify.info('Plugin disabled', `${plugin.display_name} is now inactive.`);
      }
    } catch {
      notify.error('Failed to toggle plugin', 'Please try again.');
    } finally {
      setTogglingId(null);
    }
  }

  const columns = useMemo<ColumnDef<Plugin>[]>(
    () => [
      {
        id: 'name',
        header: 'Plugin',
        accessorFn: (row) => row.display_name,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <Stack gap={2}>
              <Group gap="xs" wrap="nowrap">
                <Text size="sm" fw={500}>
                  {p.display_name}
                </Text>
                {p.has_errors && (
                  <Badge
                    size="xs"
                    color="red"
                    variant="light"
                    leftSection={<IconAlertTriangle size={10} />}
                  >
                    errors
                  </Badge>
                )}
              </Group>
              <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
                {p.slug}
              </Text>
            </Stack>
          );
        },
      },
      {
        id: 'version',
        header: 'Version',
        size: 100,
        accessorFn: (row) => row.version,
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace">
            {getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'parts',
        header: 'Parts',
        size: 180,
        accessorFn: (row) => row.parts.join(','),
        cell: ({ row }) => (
          <Group gap={4}>
            {row.original.parts.map((part) => (
              <Badge key={part} size="xs" color={PART_COLORS[part]} variant="light">
                {part}
              </Badge>
            ))}
          </Group>
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
              disabled={p.has_errors || togglingId === p.id}
              aria-label={p.enabled ? `Disable ${p.display_name}` : `Enable ${p.display_name}`}
              onChange={(e) => {
                e.stopPropagation();
                void handleToggle(p, e.currentTarget.checked);
              }}
              onClick={(e) => {
                e.stopPropagation();
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
                  aria-label={`Actions for ${p.display_name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(p);
                  }}
                >
                  View details
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUninstall(p);
                  }}
                >
                  Uninstall…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          );
        },
      },
    ],
    [togglingId, onSelect, onUninstall],
  );

  return (
    <Stack gap="sm">
      <Alert icon={<IconInfoCircle size={14} />} color="blue" variant="light" p="xs">
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Stage 1 shows all installed plugins regardless of tenant scope. Tenant-scoped plugins will
          be filtered in stage 2.
        </Text>
      </Alert>

      <Group gap="sm" align="flex-end">
        <TextInput
          placeholder="Search name or slug…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.currentTarget.value);
          }}
          style={{ flex: 1 }}
          aria-label="Search installed plugins"
        />
        <Select
          data={ENABLED_OPTIONS}
          value={filter.enabled}
          onChange={handleEnabledChange}
          w={140}
          aria-label="Filter by enabled state"
        />
      </Group>

      <DataTable
        data={plugins}
        columns={columns}
        sorting
        pagination={{ pageSize: 20 }}
        urlSyncKey="installed-plugins"
        onRowClick={onSelect}
        emptyState={
          <EmptyState
            icon={IconPlug}
            title="No plugins installed"
            description="Install a plugin from the Marketplace or by reference."
          />
        }
        caption="Installed plugins"
      />
    </Stack>
  );
}
