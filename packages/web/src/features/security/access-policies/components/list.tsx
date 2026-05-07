/**
 * <AccessPolicyList> — DataTable list of access policies.
 *
 * Stage-2: data is fetched from the daemon via Orval-generated React-Query
 * hooks. While the request is in flight an empty array is rendered;
 * React Query handles refetch + caching.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Alert, Text, Tooltip } from '@mantine/core';
import dayjs from 'dayjs';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { IconAlertCircle, IconShield } from '@tabler/icons-react';
import { useAccessPolicyList } from '../api';
import type { AccessPolicy } from '../types';

interface AccessPolicyListProps {
  tenant: string;
  onSelect: (policy: AccessPolicy) => void;
}

const MAX_CONDITION_LEN = 60;

export function AccessPolicyList({ tenant, onSelect }: AccessPolicyListProps) {
  const { data: policies, error } = useAccessPolicyList(tenant);

  const columns = useMemo<ColumnDef<AccessPolicy>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ getValue }) => (
          <Text size="sm" fw={500}>
            {getValue<string>()}
          </Text>
        ),
      },
      {
        accessorKey: 'action',
        header: 'Action',
        size: 90,
        cell: ({ getValue }) => {
          const v = getValue<string>();
          return (
            <StatusBadge kind={v === 'allow' ? 'active' : 'error'} size="sm">
              {v}
            </StatusBadge>
          );
        },
      },
      {
        accessorKey: 'priority',
        header: 'Priority',
        size: 90,
        cell: ({ getValue }) => <Text size="sm">{getValue<number>()}</Text>,
      },
      {
        accessorKey: 'condition',
        header: 'Condition',
        cell: ({ getValue }) => {
          const full = getValue<string>();
          const truncated =
            full.length > MAX_CONDITION_LEN ? `${full.slice(0, MAX_CONDITION_LEN)}…` : full;
          return (
            <Tooltip label={full} multiline maw={400} disabled={full.length <= MAX_CONDITION_LEN}>
              <Text
                size="sm"
                style={{
                  fontFamily: 'monospace',
                  cursor: full.length > MAX_CONDITION_LEN ? 'help' : undefined,
                }}
              >
                {truncated}
              </Text>
            </Tooltip>
          );
        },
      },
      {
        accessorKey: 'enabled',
        header: 'Enabled',
        size: 90,
        cell: ({ getValue }) => (
          <StatusBadge kind={getValue<boolean>() ? 'active' : 'neutral'} size="sm">
            {getValue<boolean>() ? 'Yes' : 'No'}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'created_at',
        header: 'Created',
        size: 140,
        cell: ({ getValue }) => {
          const v = getValue<string>();
          return (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {v ? dayjs(v).format('MMM D, YYYY') : '—'}
            </Text>
          );
        },
      },
    ],
    [],
  );

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />} title="Failed to load policies">
        {error.message}
      </Alert>
    );
  }

  return (
    <DataTable
      data={policies}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="access-policies"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconShield}
          title="No access policies"
          description="Create your first access policy to get started."
        />
      }
      caption="Access policies"
    />
  );
}
