/**
 * <ShareDashboardModal> — visibility + permission editor for a dashboard.
 *
 * Three visibility levels:
 *   - Private          (scope='personal')                — owner only.
 *   - Shared           (scope='shared',  role + user grants) — selected roles/users.
 *   - Public to tenant (scope='tenant',  share_permission) — everyone with read.
 *
 * For Shared and Public, a "Default permission" radio picks read-only vs
 * read/update for everyone in scope. For Shared, two grant tables let the
 * owner promote specific roles or users above the default to write access
 * (or pin them at read).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  MultiSelect,
  Radio,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconLock,
  IconShare,
  IconTrash,
  IconUsers,
  IconWorld,
} from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import type {
  Dashboard,
  DashboardPermissionLevel,
  DashboardRoleGrant,
  DashboardUserGrant,
} from '@/api/resources';
import { updateDashboard } from '../api';

type Visibility = 'personal' | 'shared' | 'tenant';

interface ShareDashboardModalProps {
  opened: boolean;
  dashboard: Dashboard;
  onClose: () => void;
}

export function ShareDashboardModal({ opened, dashboard, onClose }: ShareDashboardModalProps) {
  const allRoles = useMockStore((s) => s.roles);
  const allUsers = useMockStore((s) => s.users);
  const memberships = useMockStore((s) => s.memberships);

  // Tenant-scoped role + user options.
  const tenantRoleOptions = useMemo(() => {
    return Object.values(allRoles)
      .filter((r) => r.tenant_id === dashboard.tenant_id)
      .map((r) => ({ value: r.id, label: r.name }));
  }, [allRoles, dashboard.tenant_id]);

  const tenantUserOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const m of Object.values(memberships)) {
      if (m.tenant_id === dashboard.tenant_id && m.state === 'active') ids.add(m.user_id);
    }
    return Array.from(ids).map((uid) => {
      const u = allUsers[uid];
      return { value: uid, label: u?.name ?? u?.email ?? uid };
    });
  }, [memberships, allUsers, dashboard.tenant_id]);

  // Local form state — seeded from the dashboard.
  const [visibility, setVisibility] = useState<Visibility>(dashboard.scope);
  const [defaultPerm, setDefaultPerm] = useState<DashboardPermissionLevel>(
    dashboard.share_permission ?? 'read',
  );
  const [sharedRoleIds, setSharedRoleIds] = useState<string[]>(dashboard.shared_role_ids);
  const [roleGrants, setRoleGrants] = useState<DashboardRoleGrant[]>(dashboard.role_grants ?? []);
  const [userGrants, setUserGrants] = useState<DashboardUserGrant[]>(dashboard.user_grants ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset form when re-opening for a different dashboard.
  // Bounded — fires only on open or dashboard change, not every render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (opened) {
      setVisibility(dashboard.scope);
      setDefaultPerm(dashboard.share_permission ?? 'read');
      setSharedRoleIds(dashboard.shared_role_ids);
      setRoleGrants(dashboard.role_grants ?? []);
      setUserGrants(dashboard.user_grants ?? []);
      setErr(null);
    }
  }, [opened, dashboard]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleAddUserGrant(userId: string) {
    if (userGrants.some((g) => g.user_id === userId)) return;
    setUserGrants([...userGrants, { user_id: userId, level: defaultPerm }]);
  }

  function handleSetUserGrantLevel(userId: string, level: DashboardPermissionLevel) {
    setUserGrants(userGrants.map((g) => (g.user_id === userId ? { ...g, level } : g)));
  }

  function handleRemoveUserGrant(userId: string) {
    setUserGrants(userGrants.filter((g) => g.user_id !== userId));
  }

  function handleSetRoleGrantLevel(roleId: string, level: DashboardPermissionLevel) {
    if (roleGrants.some((g) => g.role_id === roleId)) {
      setRoleGrants(roleGrants.map((g) => (g.role_id === roleId ? { ...g, level } : g)));
    } else {
      setRoleGrants([...roleGrants, { role_id: roleId, level }]);
    }
  }

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      const patch: Parameters<typeof updateDashboard>[1] = {
        scope: visibility,
        share_permission: defaultPerm,
        user_grants: userGrants,
      };
      if (visibility === 'shared') {
        patch.shared_role_ids = sharedRoleIds;
        patch.role_grants = roleGrants.filter((g) => sharedRoleIds.includes(g.role_id));
      } else {
        // Wipe role-only state when leaving 'shared'.
        patch.shared_role_ids = [];
        patch.role_grants = [];
      }
      await updateDashboard(dashboard.id, patch);
      notify.success('Sharing updated', `${dashboard.name} sharing settings saved.`);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save sharing';
      setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  const isShared = visibility === 'shared';
  const isPublic = visibility === 'tenant';
  const showPermissionBlock = visibility !== 'personal';

  return (
    <Modal opened={opened} onClose={onClose} title={`Share "${dashboard.name}"`} size="lg" centered>
      <Stack gap="lg">
        {err && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={14} />}>
            {err}
          </Alert>
        )}

        {/* Visibility radio cards */}
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Visibility
          </Text>
          <Radio.Group
            value={visibility}
            onChange={(v) => {
              setVisibility(v as Visibility);
            }}
          >
            <Stack gap="xs">
              <VisibilityCard
                value="personal"
                checked={visibility === 'personal'}
                title="Private"
                description="Only you can view or edit this dashboard."
                icon={<IconLock size={16} />}
              />
              <VisibilityCard
                value="shared"
                checked={isShared}
                title="Shared with specific roles or users"
                description="Choose roles and users below. Set their permission levels individually."
                icon={<IconUsers size={16} />}
              />
              <VisibilityCard
                value="tenant"
                checked={isPublic}
                title="Public to everyone in this tenant"
                description="Any tenant member with dashboard:read access will see this dashboard."
                icon={<IconWorld size={16} />}
              />
            </Stack>
          </Radio.Group>
        </Stack>

        {/* Default permission level (shared / tenant) */}
        {showPermissionBlock && (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Default permission
            </Text>
            <Text size="xs" c="dimmed">
              {isPublic
                ? 'Applies to everyone in the tenant.'
                : 'Applies to the roles selected below unless overridden per-role or per-user.'}
            </Text>
            <Radio.Group
              value={defaultPerm}
              onChange={(v) => {
                setDefaultPerm(v as DashboardPermissionLevel);
              }}
            >
              <Group gap="lg">
                <Radio value="read" label="View only" />
                <Radio value="write" label="Can edit" />
              </Group>
            </Radio.Group>
          </Stack>
        )}

        {/* Shared roles */}
        {isShared && (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Roles with access
            </Text>
            <MultiSelect
              data={tenantRoleOptions}
              value={sharedRoleIds}
              onChange={setSharedRoleIds}
              placeholder={sharedRoleIds.length === 0 ? 'Pick roles…' : undefined}
              searchable
              clearable
              data-testid="share-roles-select"
            />
            {sharedRoleIds.length > 0 && (
              <Stack gap="xs">
                <Text size="xs" c="dimmed">
                  Per-role overrides (optional)
                </Text>
                {sharedRoleIds.map((rid) => {
                  const role = allRoles[rid];
                  const grant = roleGrants.find((g) => g.role_id === rid);
                  const level = grant?.level ?? defaultPerm;
                  return (
                    <Group key={rid} gap="sm" justify="space-between" wrap="nowrap">
                      <Text size="sm">{role?.name ?? rid}</Text>
                      <Group gap="xs">
                        {!grant && (
                          <Badge size="xs" variant="default">
                            Default
                          </Badge>
                        )}
                        <Select
                          size="xs"
                          w={140}
                          value={level}
                          onChange={(v) => {
                            if (!v) return;
                            handleSetRoleGrantLevel(rid, v as DashboardPermissionLevel);
                          }}
                          data={[
                            { value: 'read', label: 'View only' },
                            { value: 'write', label: 'Can edit' },
                          ]}
                          allowDeselect={false}
                        />
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            )}
          </Stack>
        )}

        {/* Per-user grants — independent of scope */}
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Specific user grants
          </Text>
          <Text size="xs" c="dimmed">
            Add individual users at any visibility level — they get access even if not in a shared
            role.
          </Text>
          <Select
            placeholder="Add a user…"
            data={tenantUserOptions.filter(
              (o) =>
                o.value !== dashboard.owner_user_id &&
                !userGrants.some((g) => g.user_id === o.value),
            )}
            searchable
            clearable
            value={null}
            onChange={(v) => {
              if (v) handleAddUserGrant(v);
            }}
            data-testid="share-add-user"
          />
          {userGrants.length > 0 && (
            <Stack gap="xs">
              {userGrants.map((g) => {
                const user = allUsers[g.user_id];
                return (
                  <Group key={g.user_id} gap="sm" justify="space-between" wrap="nowrap">
                    <Text size="sm">{user?.name ?? user?.email ?? g.user_id}</Text>
                    <Group gap="xs">
                      <Select
                        size="xs"
                        w={140}
                        value={g.level}
                        onChange={(v) => {
                          if (!v) return;
                          handleSetUserGrantLevel(g.user_id, v as DashboardPermissionLevel);
                        }}
                        data={[
                          { value: 'read', label: 'View only' },
                          { value: 'write', label: 'Can edit' },
                        ]}
                        allowDeselect={false}
                      />
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => {
                          handleRemoveUserGrant(g.user_id);
                        }}
                        aria-label={`Remove ${user?.name ?? g.user_id}`}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Stack>

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<IconShare size={14} />}
            loading={saving}
            onClick={() => {
              void handleSave();
            }}
            data-testid="share-dashboard-save"
          >
            Save sharing
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

interface VisibilityCardProps {
  value: Visibility;
  checked: boolean;
  title: string;
  description: string;
  icon: React.ReactNode;
}

function VisibilityCard({ value, checked, title, description, icon }: VisibilityCardProps) {
  return (
    <Box
      p="sm"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        border: checked
          ? '1px solid var(--mantine-color-riokuOrange-6)'
          : '1px solid var(--mantine-color-default-border)',
        background: checked ? 'var(--mantine-color-riokuOrange-light)' : undefined,
      }}
    >
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Radio value={value} aria-label={title} mt={2} />
        <Box style={{ color: 'var(--mantine-color-riokuOrange-6)' }}>{icon}</Box>
        <Stack gap={2}>
          <Text size="sm" fw={600}>
            {title}
          </Text>
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        </Stack>
      </Group>
    </Box>
  );
}
