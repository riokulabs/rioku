/**
 * Effective permissions page — /t/$tenant/security/effective-permissions
 *
 * Per-user effective-permissions view. The page lets the operator pick a user
 * (filtered to active memberships in the current tenant) and renders the
 * existing `<EffectivePermissionsPanel>` with `scope="user"`.
 *
 * Stage-2: user list comes from the daemon-backed `useUserList` hook.
 */
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Select, Text, Card, Alert } from '@mantine/core';
import { IconUserShield, IconInfoCircle } from '@tabler/icons-react';
import { EffectivePermissionsPanel } from '@/components/effective-permissions-panel';
import { requirePermissions } from '@/hooks/use-before-load';
import { useUserList } from '@/features/security/users';

interface UserOption {
  value: string;
  label: string;
}

function EffectivePermissionsPage() {
  const { tenant } = Route.useParams();
  const tenantId = tenant;

  // Stage-2: pull active memberships from the daemon-backed user list.
  const usersResult = useUserList(tenantId, { search: '', status: 'active' });

  const userOptions: UserOption[] = useMemo(() => {
    const opts: UserOption[] = [];
    for (const item of usersResult.items) {
      if (item.membership.state !== 'active') continue;
      const u = item.user;
      opts.push({ value: u.id, label: `${u.name} <${u.email}>` });
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }, [usersResult.items]);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    userOptions[0]?.value ?? null,
  );

  return (
    <Stack gap="md" p="md" data-testid="effective-permissions-page">
      <Group gap="xs">
        <IconUserShield size={20} />
        <Title order={2}>Effective permissions</Title>
      </Group>

      <Text size="sm" c="dimmed">
        Computed permission set for a user, including direct grants, inherited parent role grants,
        and RBAC policy contributions. Each permission is annotated with its source path.
      </Text>

      <Group>
        <Select
          label="User"
          placeholder="Select a user"
          searchable
          data={userOptions}
          value={selectedUserId}
          onChange={setSelectedUserId}
          style={{ minWidth: 320 }}
          data-testid="effective-permissions-user-select"
          disabled={userOptions.length === 0}
        />
      </Group>

      {userOptions.length === 0 ? (
        <Alert color="gray" icon={<IconInfoCircle size={16} />}>
          No active memberships in this tenant.
        </Alert>
      ) : selectedUserId === null ? (
        <Alert color="gray" icon={<IconInfoCircle size={16} />}>
          Select a user above to view their effective permissions.
        </Alert>
      ) : (
        <Card withBorder padding="md">
          <EffectivePermissionsPanel scope="user" id={selectedUserId} tenantId={tenantId} />
        </Card>
      )}
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/effective-permissions')({
  beforeLoad: requirePermissions({ required: ['role:read'] }),
  component: EffectivePermissionsPage,
});
