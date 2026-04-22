/**
 * <AccessPolicyList> — DataTable list of access policies.
 *
 * Columns: name, action, priority, condition (truncated), enabled, created_at.
 * Clicking a row calls onSelect to open the detail drawer.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Text, Tooltip } from '@mantine/core';
import dayjs from 'dayjs';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { IconShield } from '@tabler/icons-react';
import { useAccessPolicyList } from '../api';
import type { AccessPolicy } from '../types';

interface AccessPolicyListProps {
  onSelect: (policy: AccessPolicy) => void;
}

const MAX_CONDITION_LEN = 60;

export function AccessPolicyList({ onSelect }: AccessPolicyListProps) {
  const policies = useAccessPolicyList();

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
            <StatusBadge
              kind={v === 'allow' ? 'active' : 'error'}
              size="sm"
            >
              {v}
            </StatusBadge>
          );
        },
      },
      {
        accessorKey: 'priority',
        header: 'Priority',
        size: 90,
        cell: ({ getValue }) => (
          <Text size="sm">{getValue<number>()}</Text>
        ),
      },
      {
        accessorKey: 'condition',
        header: 'Condition',
        cell: ({ getValue }) => {
          const full = getValue<string>();
          const truncated =
            full.length > MAX_CONDITION_LEN
              ? `${full.slice(0, MAX_CONDITION_LEN)}…`
              : full;
          return (
            <Tooltip label={full} multiline maw={400} disabled={full.length <= MAX_CONDITION_LEN}>
              <Text size="sm" style={{ fontFamily: 'monospace', cursor: full.length > MAX_CONDITION_LEN ? 'help' : undefined }}>
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
        cell: ({ getValue }) => (
          <Text size="sm" c="dimmed">
            {dayjs(getValue<string>()).format('MMM D, YYYY')}
          </Text>
        ),
      },
    ],
    [],
  );

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
