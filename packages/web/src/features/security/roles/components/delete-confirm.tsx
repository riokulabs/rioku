/**
 * <RoleDeleteConfirm> — deletion confirmation with affected-user count warning.
 */
import { Stack, Text, Button, Group, Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useRoleUserCounts } from '../api';
import type { Role } from '../types';

interface RoleDeleteConfirmProps {
  role: Role;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function RoleDeleteConfirm({ role, onConfirm, onCancel }: RoleDeleteConfirmProps) {
  const userCounts = useRoleUserCounts();
  const affectedCount = userCounts[role.id] ?? 0;

  return (
    <Stack gap="md">
      <Text>
        Are you sure you want to delete the role{' '}
        <Text span fw={700}>
          {role.name}
        </Text>
        ?
      </Text>

      {affectedCount > 0 && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="orange"
          variant="light"
          title="Users affected"
        >
          {affectedCount} user{affectedCount !== 1 ? 's have' : ' has'} this role assigned. Deleting
          will remove the role from their memberships.
        </Alert>
      )}

      {role.system && (
        <Alert color="red" variant="light" title="System role">
          This is a system role. Deleting it may break built-in functionality.
        </Alert>
      )}

      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="red" onClick={() => void onConfirm()}>
          Delete role
        </Button>
      </Group>
    </Stack>
  );
}
