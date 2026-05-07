/**
 * Effective permissions page — /t/$tenant/security/effective-permissions
 *
 * Per-user effective-permissions view. The page lets the operator pick a user
 * (filtered to active memberships in the current tenant) and renders the
 * existing `<EffectivePermissionsPanel>` with `scope="user"`.
 *
 * Stage-1 carve-out: backed by mock-store data via `useMockStore`. Plan-13
 * will swap the user-list source to a real daemon endpoint when the Identity
 * proto coverage lands (decisions-needed.md item 02-001).
 */
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Select, Text, Card, Alert } from '@mantine/core';
import { IconUserShield, IconInfoCircle } from '@tabler/icons-react';
import { EffectivePermissionsPanel } from '@/components/effective-permissions-panel';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';

interface UserOption {
  value: string;
  label: string;
}

function EffectivePermissionsPage() {
  const { tenant } = Route.useParams();
  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';

  const memberships = useMockStore((s) => s.memberships);
  const users = useMockStore((s) => s.users);

  const userOptions: UserOption[] = useMemo(() => {
    const opts: UserOption[] = [];
    for (const m of Object.values(memberships)) {
      if (m.tenant_id !== tenantId) continue;
      if (m.state !== 'active') continue;
      const u = users[m.user_id];
      if (!u) continue;
      opts.push({ value: u.id, label: `${u.name} <${u.email}>` });
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }, [memberships, users, tenantId]);

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
        Computed permission set for a user, including direct grants, inherited
        parent role grants, and RBAC policy contributions. Each permission is
        annotated with its source path.
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
          <EffectivePermissionsPanel
            scope="user"
            id={selectedUserId}
            tenantId={tenantId}
          />
        </Card>
      )}
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/effective-permissions')({
  beforeLoad: requirePermissions({ required: ['role:read'] }),
  component: EffectivePermissionsPage,
});
