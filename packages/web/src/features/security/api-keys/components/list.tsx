/**
 * <ApiKeyList> — DataTable list of API keys with status filter.
 */
import { useMemo, useState, useCallback } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Badge,
  Text,
  Select,
  Stack,
  Group,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { IconKey, IconTrash, IconRefresh, IconBan } from '@tabler/icons-react';
import { DataTable, type BulkAction } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { notify } from '@/hooks/use-notify';
import { useApiKeyList, revokeApiKey, deleteApiKey, rotateApiKey } from '../api';
import type { ApiKeyWithMeta, ApiKeyFilter } from '../types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_KIND = {
  active:  'active',
  revoked: 'error',
  expired: 'warn',
} as const satisfies Record<ApiKeyWithMeta['display_status'], 'active' | 'error' | 'warn'>;

const DEFAULT_FILTER: ApiKeyFilter = { status: 'all' };

interface ApiKeyListProps {
  tenantId: string;
  onSelect?: (key: ApiKeyWithMeta) => void;
  onCreated?: (fullValue: string) => void;
}

export function ApiKeyList({ tenantId, onSelect }: ApiKeyListProps) {
  const [filter, setFilter] = useState<ApiKeyFilter>(DEFAULT_FILTER);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleStatusChange = useCallback((value: string | null) => {
    setFilter({ status: (value ?? 'all') as ApiKeyFilter['status'] });
  }, []);

  const keys = useApiKeyList(tenantId, filter);

  async function handleRevoke(id: string) {
    setLoadingId(id);
    try {
      await revokeApiKey(id);
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
      await deleteApiKey(id);
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
      const result = await rotateApiKey(id);
      notify.success(
        'API key rotated',
        `New key generated. Copy it now: ${result.fullValue.slice(0, 20)}…`,
      );
    } catch {
      notify.error('Failed to rotate key', 'Please try again.');
    } finally {
      setLoadingId(null);
    }
  }

  const handleBulkRevoke = useCallback(async (ids: string[]) => {
    let failed = 0;
    for (const id of ids) {
      try {
        await revokeApiKey(id);
      } catch {
        failed++;
      }
    }
    const succeeded = ids.length - failed;
    if (succeeded > 0) {
      notify.success('Keys revoked', `${String(succeeded)} key${succeeded !== 1 ? 's' : ''} revoked.`);
    }
    if (failed > 0) {
      notify.error('Some revocations failed', `${String(failed)} key${failed !== 1 ? 's' : ''} could not be revoked.`);
    }
  }, []);

  const handleBulkDelete = useCallback(async (ids: string[]) => {
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteApiKey(id);
      } catch {
        failed++;
      }
    }
    const succeeded = ids.length - failed;
    if (succeeded > 0) {
      notify.success('Keys deleted', `${String(succeeded)} key${succeeded !== 1 ? 's' : ''} deleted.`);
    }
    if (failed > 0) {
      notify.error('Some deletions failed', `${String(failed)} key${failed !== 1 ? 's' : ''} could not be deleted.`);
    }
  }, []);

  const bulkActions = useMemo<BulkAction[]>(() => [
    {
      label: 'Revoke selected',
      color: 'orange',
      onClick: (ids) => { void handleBulkRevoke(ids); },
    },
    {
      label: 'Delete selected',
      color: 'red',
      onClick: (ids) => { void handleBulkDelete(ids); },
    },
  ], [handleBulkRevoke, handleBulkDelete]);

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
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace" c="dimmed">
            {getValue<string>()}…
          </Text>
        ),
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
          <Text size="sm" c="dimmed">
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
          if (days === undefined) return <Text size="sm" c="dimmed">Never</Text>;
          if (days < 0) return <Text size="sm" c="red">Expired</Text>;
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
                  color="red"
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
    [loadingId],
  );

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end">
        <Select
          data={STATUS_OPTIONS}
          value={filter.status}
          onChange={handleStatusChange}
          w={160}
          aria-label="Filter by status"
        />
      </Group>

      <DataTable
        data={keys}
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
