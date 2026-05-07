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
import type { RbacPolicyFull, RbacSubjectType } from '../types';

interface RbacPolicyListProps {
  tenant: string;
  onSelect: (policy: RbacPolicyFull) => void;
}

const SUBJECT_COLORS: Record<RbacSubjectType, string> = {
  user: 'violet',
  group: 'blue',
  'service-account': 'orange',
};

const SUBJECT_LABELS: Record<RbacSubjectType, string> = {
  user: 'User',
  group: 'Group',
  'service-account': 'Service account',
};

export function RbacPolicyList({ tenant, onSelect }: RbacPolicyListProps) {
  const policies = useRbacPolicyList(tenant);

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
        accessorKey: 'subject_type',
        header: 'Subject',
        size: 160,
        cell: ({ getValue }) => {
          const t = getValue<RbacSubjectType>();
          return (
            <Badge color={SUBJECT_COLORS[t]} variant="light" size="sm">
              {SUBJECT_LABELS[t]}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'role_id',
        header: 'Role',
        size: 160,
        cell: ({ getValue }) => (
          <Text size="sm" style={{ fontFamily: 'monospace' }}>
            {getValue<string>()}
          </Text>
        ),
      },
      {
        accessorKey: 'enabled',
        header: 'Status',
        size: 100,
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <Badge variant="light" color="green" size="sm">
              Enabled
            </Badge>
          ) : (
            <Badge variant="light" color="gray" size="sm">
              Disabled
            </Badge>
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
