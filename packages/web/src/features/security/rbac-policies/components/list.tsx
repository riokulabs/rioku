/**
 * <RbacPolicyList> — DataTable list of RBAC policies.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Text } from '@mantine/core';
import dayjs from 'dayjs';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { IconLock } from '@tabler/icons-react';
import { useRbacPolicyList } from '../api';
import type { RbacPolicyFull, RbacPolicyType } from '../types';

interface RbacPolicyListProps {
  onSelect: (policy: RbacPolicyFull) => void;
}

const TYPE_COLORS: Record<RbacPolicyType, string> = {
  'totp-required': 'violet',
  'step-up-required': 'orange',
  'login-window': 'blue',
  custom: 'gray',
};

const TYPE_LABELS: Record<RbacPolicyType, string> = {
  'totp-required': 'TOTP Required',
  'step-up-required': 'Step-up Required',
  'login-window': 'Login Window',
  custom: 'Custom',
};

export function RbacPolicyList({ onSelect }: RbacPolicyListProps) {
  const policies = useRbacPolicyList();

  const columns = useMemo<ColumnDef<RbacPolicyFull>[]>(
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
        accessorKey: 'policy_type',
        header: 'Type',
        size: 160,
        cell: ({ getValue }) => {
          const t = getValue<RbacPolicyType>();
          return (
            <Badge color={TYPE_COLORS[t]} variant="light" size="sm">
              {TYPE_LABELS[t]}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'affected_role_ids',
        header: 'Affected Roles',
        size: 120,
        cell: ({ getValue }) => {
          const ids = getValue<string[]>();
          return <Text size="sm">{ids.length} role{ids.length !== 1 ? 's' : ''}</Text>;
        },
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
      urlSyncKey="rbac-policies"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconLock}
          title="No RBAC policies"
          description="Create your first RBAC policy to get started."
        />
      }
      caption="RBAC policies"
    />
  );
}
