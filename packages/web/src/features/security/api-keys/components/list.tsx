/**
 * <ApiKeyList> — DataTable list of API keys with status filter.
 *
 * Stage-2 plan-02. Wired to the real daemon via `useApiKeyList` /
 * `useApiKeyMutations`. Bulk export serializes the same fields the
 * API returns — no secret material.
 */
import { useMemo, useState, useCallback } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text, Select, Stack, Group, ActionIcon, TextInput, Tooltip } from '@mantine/core';
import {
  IconKey,
  IconSearch,
  IconTrash,
  IconRefresh,
  IconBan,
  IconDownload,
} from '@tabler/icons-react';
import { DataTable, type BulkAction } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { notify } from '@/hooks/use-notify';
import { useApiKeyList, useApiKeyMutations } from '../api';
import type { ApiKeyWithMeta, ApiKeyFilter } from '../types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_KIND = {
  active: 'active',
  revoked: 'error',
  expired: 'warn',
} as const satisfies Record<ApiKeyWithMeta['display_status'], 'active' | 'error' | 'warn'>;

const DEFAULT_FILTER: ApiKeyFilter = { status: 'all' };

interface ApiKeyListProps {
  tenantId: string;
  onSelect?: (key: ApiKeyWithMeta) => void;
  onRotated?: (fullValue: string) => void;
}

export function ApiKeyList({ tenantId, onSelect, onRotated }: ApiKeyListProps) {
  const [filter, setFilter] = useState<ApiKeyFilter>(DEFAULT_FILTER);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const handleStatusChange = useCallback((value: string | null) => {
    setFilter({ status: (value ?? 'all') as ApiKeyFilter['status'] });
  }, []);

  const keys = useApiKeyList(tenantId, filter);
  const mut = useApiKeyMutations(tenantId);

  const filteredKeys = useMemo(() => {
    if (!search.trim()) return keys;
    const q = search.toLowerCase();
    return keys.filter(
      (k) => k.name.toLowerCase().includes(q) || k.prefix.toLowerCase().includes(q),
    );
  }, [keys, search]);

  async function handleRevoke(id: string) {
    setLoadingId(id);
    try {
      await mut.revokeApiKey(id);
      notify.success('API key revoked', 'The key has been invalidated.');
    } catch {
      notify.error('Failed to revoke key', 'Please try again.');
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(id: string) {
    setLoadingId(id);
    try {
      await mut.deleteApiKey(id);
      notify.success('API key deleted', 'The key has been removed.');
    } catch {
      notify.error('Failed to delete key', 'Please try again.');
    } finally {
      setLoadingId(null);
    }
  }

  async function handleRotate(id: string) {
    setLoadingId(id);
    try {
      const result = await mut.rotateApiKey(id);
      onRotated?.(result.fullValue);
      notify.success('API key rotated', 'A new key value has been generated.');
    } catch {
      notify.error('Failed to rotate key', 'Please try again.');
    } finally {
      setLoadingId(null);
    }
  }

  const handleBulkRevoke = useCallback(
    async (ids: string[]) => {
      let failed = 0;
      for (const id of ids) {
        try {
          await mut.revokeApiKey(id);
        } catch {
          failed++;
        }
      }
      const succeeded = ids.length - failed;
      if (succeeded > 0) {
        notify.success(
          'Keys revoked',
          `${String(succeeded)} key${succeeded !== 1 ? 's' : ''} revoked.`,
        );
      }
      if (failed > 0) {
        notify.error(
          'Some revocations failed',
          `${String(failed)} key${failed !== 1 ? 's' : ''} could not be revoked.`,
        );
      }
    },
    [mut],
  );

  const handleBulkDelete = useCallback(
    async (ids: string[]) => {
      let failed = 0;
      for (const id of ids) {
        try {
          await mut.deleteApiKey(id);
        } catch {
          failed++;
        }
      }
      const succeeded = ids.length - failed;
      if (succeeded > 0) {
        notify.success(
          'Keys deleted',
          `${String(succeeded)} key${succeeded !== 1 ? 's' : ''} deleted.`,
        );
      }
      if (failed > 0) {
        notify.error(
          'Some deletions failed',
          `${String(failed)} key${failed !== 1 ? 's' : ''} could not be deleted.`,
        );
      }
    },
    [mut],
  );

  const handleBulkExportMetadata = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      const selected = keys
        .filter((k) => idSet.has(k.id))
        .map(
          ({
            id,
            name,
            prefix,
            scope,
            tenant_id,
            created_at,
            expires_at,
            revoked,
            last_used,
          }) => ({
            id,
            name,
            prefix,
            scope,
            tenant_id,
            created_at,
            ...(expires_at !== undefined ? { expires_at } : {}),
            revoked,
            ...(last_used !== undefined ? { last_used } : {}),
          }),
        );
      const blob = new Blob([JSON.stringify(selected, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `api-keys-metadata-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      notify.success(
        'Export ready',
        `${String(selected.length)} key${selected.length !== 1 ? 's' : ''} exported (no secrets).`,
      );
    },
    [keys],
  );

  const bulkActions = useMemo<BulkAction[]>(
    () => [
      {
        label: 'Export metadata',
        color: 'blue',
        icon: IconDownload,
        onClick: (ids) => {
          handleBulkExportMetadata(ids);
        },
      },
      {
        label: 'Revoke selected',
        color: 'orange',
        onClick: (ids) => {
          void handleBulkRevoke(ids);
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
    [handleBulkExportMetadata, handleBulkRevoke, handleBulkDelete],
  );

  const columns = useMemo<ColumnDef<ApiKeyWithMeta>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ getValue }) => (
          <Text size="sm" fw={500}>
            {getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'prefix',
        header: 'Key prefix',
        accessorFn: (row) => row.prefix,
        cell: ({ getValue }) => {
          const v = getValue<string>();
          return (
            <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
              {v ? `${v}…` : '—'}
            </Text>
          );
        },
      },
      {
        id: 'scope',
        header: 'Scope',
        accessorFn: (row) => row.scope.length,
        cell: ({ row }) => (
          <Tooltip label={row.original.scope.join(', ')} withArrow>
            <Badge size="sm" variant="outline" style={{ cursor: 'default' }}>
              {row.original.scope.length} permission{row.original.scope.length !== 1 ? 's' : ''}
            </Badge>
          </Tooltip>
        ),
      },
      {
        id: 'last_used',
        header: 'Last used',
        accessorFn: (row) => row.last_used_summary,
        cell: ({ getValue }) => (
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {getValue<string | undefined>() ?? '—'}
          </Text>
        ),
      },
      {
        id: 'expires_at',
        header: 'Expires',
        accessorFn: (row) => row.expires_in_days,
        cell: ({ row }) => {
          const days = row.original.expires_in_days;
          if (days === undefined)
            return (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                Never
              </Text>
            );
          if (days < 0)
            return (
              <Text size="sm" c="red">
                Expired
              </Text>
            );
          return (
            <Text size="sm" c={days < 7 ? 'orange' : 'inherit'}>
              {days}d
            </Text>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        size: 110,
        accessorFn: (row) => row.display_status,
        cell: ({ getValue }) => {
          const status = getValue<ApiKeyWithMeta['display_status']>();
          return (
            <StatusBadge kind={STATUS_KIND[status]} size="sm">
              {status}
            </StatusBadge>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 120,
        cell: ({ row }) => {
          const key = row.original;
          const isLoading = loadingId === key.id;
          return (
            <Group gap="xs" wrap="nowrap">
              {!key.revoked && key.display_status === 'active' && (
                <Tooltip label="Rotate" withArrow>
                  <ActionIcon
                    aria-label="Rotate API key"
                    size="sm"
                    variant="subtle"
                    loading={isLoading}
                    onClick={() => void handleRotate(key.id)}
                  >
                    <IconRefresh size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              {!key.revoked && (
                <Tooltip label="Revoke" withArrow>
                  <ActionIcon
                    aria-label="Revoke API key"
                    size="sm"
                    variant="subtle"
                    color="orange"
                    loading={isLoading}
                    onClick={() => void handleRevoke(key.id)}
                  >
                    <IconBan size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label="Delete" withArrow>
                <ActionIcon
                  aria-label="Delete API key"
                  size="sm"
                  variant="subtle"
                  color="red.8"
                  loading={isLoading}
                  onClick={() => void handleDelete(key.id)}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadingId],
  );

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end">
        <TextInput
          leftSection={<IconSearch size={16} />}
          placeholder="Search API keys…"
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
          }}
          style={{ flex: 1 }}
          aria-label="Search API keys"
        />
        <Select
          data={STATUS_OPTIONS}
          value={filter.status}
          onChange={handleStatusChange}
          w={160}
          aria-label="Filter by status"
        />
      </Group>

      <DataTable
        data={filteredKeys}
        columns={columns}
        sorting
        pagination={{ pageSize: 20 }}
        urlSyncKey="api-keys"
        rowSelection="multiple"
        bulkActions={bulkActions}
        {...(onSelect ? { onRowClick: onSelect } : {})}
        emptyState={
          <EmptyState
            icon={IconKey}
            title="No API keys"
            description="Create your first API key to allow programmatic access"
          />
        }
        caption="API keys"
      />
    </Stack>
  );
}
