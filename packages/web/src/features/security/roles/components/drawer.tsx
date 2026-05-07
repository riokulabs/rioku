/**
 * <RoleDrawer> — quick-info drawer surface for a role.
 *
 * Shows the role name, system flag, member count, and grant count
 * sourced from the live daemon, plus an "Open full page" button that
 * navigates to the dedicated detail route. Used in list contexts where
 * a full editor is heavyweight (e.g., the Memberships sidebar peek).
 */
import { Stack, Group, Title, Text, Badge, Button, Divider } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useRoleUserCounts } from '../api';
import type { Role } from '../types';

interface RoleDrawerProps {
  tenant: string;
  role: Role;
  onClose: () => void;
}

export function RoleDrawer({ tenant, role, onClose }: RoleDrawerProps) {
  const userCounts = useRoleUserCounts(tenant);
  const userCount = userCounts[role.id] ?? 0;

  return (
    <Stack gap="md" data-testid="role-drawer">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={4}>{role.name}</Title>
          <Group gap="xs">
            {role.system && (
              <Badge color="gray" variant="outline" size="sm">
                system
              </Badge>
            )}
            <Badge color="blue" variant="light" size="sm" data-testid="role-drawer-member-count">
              {userCount} member{userCount !== 1 ? 's' : ''}
            </Badge>
          </Group>
        </Stack>
      </Group>

      <Divider />

      <Stack gap="xs">
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {role.grants.length} permission{role.grants.length !== 1 ? 's' : ''} granted directly.
          {role.parent_ids.length > 0 && (
            <>
              {' '}
              Inherits from {role.parent_ids.length} parent role
              {role.parent_ids.length !== 1 ? 's' : ''}.
            </>
          )}
        </Text>
      </Stack>

      <Divider />

      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose}>
          Close
        </Button>
        <Button
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/security/roles/$roleId"
          params={{ tenant, roleId: role.id }}
          rightSection={<IconExternalLink size={14} />}
          data-testid="role-drawer-open-fullpage"
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}
