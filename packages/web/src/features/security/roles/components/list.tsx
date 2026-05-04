/**
 * <RoleList> — DataTable list of roles.
 *
 * Columns: name, user count, parent count, explicit-deny count, created_at.
 * (Role has no created_at in the current type — we derive a placeholder.)
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge, Group, Text } from '@mantine/core';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { IconShieldHalf } from '@tabler/icons-react';
import { useRoleList, useRoleUserCounts } from '../api';
import type { Role } from '../types';

interface RoleListProps {
  onSelect: (role: Role) => void;
}

export function RoleList({ onSelect }: RoleListProps) {
  const roles = useRoleList();
  const userCounts = useRoleUserCounts();

  const columns = useMemo<ColumnDef<Role>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ getValue, row }) => (
          <Group gap={6} wrap="nowrap" align="center">
            <Text size="sm" fw={500}>
              {getValue<string>()}
            </Text>
            {row.original.system && (
              <Badge size="xs" variant="outline" color="gray">
                system
              </Badge>
            )}
          </Group>
        ),
      },
      {
        id: 'user_count',
        header: 'Users',
        size: 80,
        accessorFn: (row) => userCounts[row.id] ?? 0,
        cell: ({ getValue }) => <Text size="sm">{getValue<number>()}</Text>,
      },
      {
        id: 'parent_count',
        header: 'Parents',
        size: 90,
        accessorFn: (row) => row.parent_ids.length,
        cell: ({ getValue }) => <Text size="sm">{getValue<number>()}</Text>,
      },
      {
        id: 'deny_count',
        header: 'Denies',
        size: 80,
        accessorFn: (row) => row.denies.length,
        cell: ({ getValue }) => {
          const count = getValue<number>();
          return count > 0 ? (
            <Text size="sm" c="red">
              {count}
            </Text>
          ) : (
            <Text size="sm">{count}</Text>
          );
        },
      },
      {
        id: 'grant_count',
        header: 'Grants',
        size: 80,
        accessorFn: (row) => row.grants.length,
        cell: ({ getValue }) => <Text size="sm">{getValue<number>()}</Text>,
      },
    ],
    [userCounts],
  );

  return (
    <DataTable
      data={roles}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="roles"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconShieldHalf}
          title="No roles"
          description="Create your first role to get started."
        />
      }
      caption="Roles"
    />
  );
}
