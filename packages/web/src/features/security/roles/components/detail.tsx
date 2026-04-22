/**
 * <RoleDetail> — role detail with four sections:
 *   1. Parents (multi-select, cycle-checked on save)
 *   2. Grants (add/remove permission + optional CEL condition)
 *   3. Explicit Denies (add/remove permission key)
 *   4. Effective-permissions preview for a sample user
 */
import { useState, useCallback } from 'react';
import {
  Stack,
  Group,
  Title,
  Text,
  Badge,
  Button,
  Divider,
  MultiSelect,
  ActionIcon,
  Alert,
  Select,
  Paper,
  Tabs,
} from '@mantine/core';
import { IconTrash, IconPlus, IconAlertCircle } from '@tabler/icons-react';
import { PermissionSelector } from '@/components/permission-selector';
import { PermissionPathTrace } from '@/components/permission-path-trace';
import { EffectivePermissionsPanel } from '@/components/effective-permissions-panel';
import { ConditionEditor } from '@/components/condition-editor';
import { validateRoleSave } from '@/host/role-resolver';
import { useMockStore } from '@/api/mock-store';
import { useRoleUserCounts, useRolesMap, updateRoleMutation } from '../api';
import type { Role, GrantRow } from '../types';

interface RoleDetailProps {
  role: Role;
  onDelete: () => void;
  onClose: () => void;
}

// ─── Grant row editor ─────────────────────────────────────────────────────────

interface GrantRowEditorProps {
  row: GrantRow;
  onChange: (updated: GrantRow) => void;
  onRemove: () => void;
}

function GrantRowEditor({ row, onChange, onRemove }: GrantRowEditorProps) {
  const [showCondition, setShowCondition] = useState(!!row.when);

  return (
    <Paper withBorder p="xs" radius="sm">
      <Stack gap="xs">
        <Group align="flex-end" gap="xs">
          <PermissionSelector
            value={row.permission ? [row.permission] : []}
            onChange={(v) => { onChange({ ...row, permission: v[0] ?? '' }); }}
            label="Permission"
          />
          <ActionIcon
            color="red"
            variant="subtle"
            onClick={onRemove}
            aria-label="Remove grant"
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
        {!showCondition && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => { setShowCondition(true); }}
          >
            + Add condition
          </Button>
        )}
        {showCondition && (
          <ConditionEditor
            label="Condition (optional)"
            value={row.when}
            onChange={(v) => { onChange({ ...row, when: v }); }}
            height={80}
          />
        )}
      </Stack>
    </Paper>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

const SAMPLE_PERMISSIONS = [
  'rioku.viewer.read',
  'rioku.ops.read',
  'rioku.admin.read',
];

export function RoleDetail({ role, onDelete, onClose: _onClose }: RoleDetailProps) {
  const allRoles = useRolesMap();
  const userCounts = useRoleUserCounts();
  const users = useMockStore((s) => s.users);
  const memberships = useMockStore((s) => s.memberships);

  // Parent editor state
  const [parentIds, setParentIds] = useState<string[]>(role.parent_ids);
  const [parentError, setParentError] = useState<string | null>(null);

  // Grants editor state
  const [grantRows, setGrantRows] = useState<GrantRow[]>(
    role.grants.map((g, i) => ({ _key: `g-${String(i)}`, permission: g.permission, when: g.when ?? '' })),
  );

  // Denies editor state
  const [denies, setDenies] = useState<string[]>(role.denies);

  // Effective-perms preview state
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  const [previewPermission, setPreviewPermission] = useState(SAMPLE_PERMISSIONS[0] ?? '');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Parent options — exclude self
  const parentOptions = Object.values(allRoles)
    .filter((r) => r.id !== role.id)
    .map((r) => ({ value: r.id, label: r.name }));

  // User options for effective-perms preview
  // Find users who have this tenant's memberships
  const userOptions = Object.values(users).map((u) => ({
    value: u.id,
    label: `${u.name} (${u.email})`,
  }));

  // Find a tenant ID from any membership to pass to PermissionPathTrace
  const firstMembership = Object.values(memberships)[0];
  const previewTenantId = firstMembership?.tenant_id ?? '';

  const addGrantRow = useCallback(() => {
    setGrantRows((prev) => [
      ...prev,
      { _key: `g-new-${String(Date.now())}`, permission: '', when: '' },
    ]);
  }, []);

  const removeGrantRow = useCallback((key: string) => {
    setGrantRows((prev) => prev.filter((r) => r._key !== key));
  }, []);

  const updateGrantRow = useCallback((updated: GrantRow) => {
    setGrantRows((prev) => prev.map((r) => (r._key === updated._key ? updated : r)));
  }, []);

  async function handleSaveAll() {
    setParentError(null);
    setSaveError(null);

    // Build candidate role for validation
    const candidate: Role = {
      ...role,
      parent_ids: parentIds,
      grants: grantRows
        .filter((r) => r.permission.trim().length > 0)
        .map((r) => ({ permission: r.permission, ...(r.when ? { when: r.when } : {}) })),
      denies,
    };

    const validation = validateRoleSave(candidate, allRoles);
    if (!validation.ok) {
      setParentError(validation.reason);
      return;
    }

    setSaving(true);
    try {
      await updateRoleMutation(role.id, {
        parent_ids: candidate.parent_ids,
        grants: candidate.grants,
        denies: candidate.denies,
      });
    } catch {
      setSaveError('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const userCount = userCounts[role.id] ?? 0;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={4}>{role.name}</Title>
          <Group gap="xs">
            {role.system && <Badge color="gray" variant="outline" size="sm">system</Badge>}
            <Badge color="blue" variant="light" size="sm">
              {userCount} user{userCount !== 1 ? 's' : ''}
            </Badge>
          </Group>
        </Stack>
        <Group gap="xs">
          <Button size="xs" variant="light" color="red" onClick={onDelete}>
            Delete
          </Button>
        </Group>
      </Group>

      <Divider />

      <Tabs defaultValue="parents">
        <Tabs.List>
          <Tabs.Tab value="parents">Parents</Tabs.Tab>
          <Tabs.Tab value="grants">Grants</Tabs.Tab>
          <Tabs.Tab value="denies">Denies</Tabs.Tab>
          <Tabs.Tab value="preview">Effective Perms</Tabs.Tab>
        </Tabs.List>

        {/* ── Parents ── */}
        <Tabs.Panel value="parents" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Roles this role inherits grants from. Self and cycles are rejected.
            </Text>
            {parentError && (
              <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
                {parentError}
              </Alert>
            )}
            <MultiSelect
              label="Parent roles"
              data={parentOptions}
              value={parentIds}
              onChange={(v) => {
                setParentError(null);
                setParentIds(v);
              }}
              searchable
              clearable
            />
          </Stack>
        </Tabs.Panel>

        {/* ── Grants ── */}
        <Tabs.Panel value="grants" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Permissions explicitly granted by this role. Inherited grants come from parent roles.
            </Text>
            {grantRows.map((row) => (
              <GrantRowEditor
                key={row._key}
                row={row}
                onChange={updateGrantRow}
                onRemove={() => { removeGrantRow(row._key); }}
              />
            ))}
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={addGrantRow}
            >
              Add grant
            </Button>
          </Stack>
        </Tabs.Panel>

        {/* ── Denies ── */}
        <Tabs.Panel value="denies" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Permissions explicitly denied by this role. Denies override inherited grants.
            </Text>
            <PermissionSelector
              label="Denied permissions"
              value={denies}
              onChange={setDenies}
            />
          </Stack>
        </Tabs.Panel>

        {/* ── Effective perms preview ── */}
        <Tabs.Panel value="preview" pt="md">
          <Tabs defaultValue="overview" variant="outline">
            <Tabs.List>
              <Tabs.Tab value="overview">Role overview</Tabs.Tab>
              <Tabs.Tab value="trace">Trace for user</Tabs.Tab>
            </Tabs.List>

            {/* ── Overview: all permissions this role effectively grants ── */}
            <Tabs.Panel value="overview" pt="md">
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  Full set of permissions this role effectively grants (own grants + inherited from parents).
                </Text>
                <EffectivePermissionsPanel scope="role" id={role.id} />
              </Stack>
            </Tabs.Panel>

            {/* ── Trace: single-permission debugger for a specific user ── */}
            <Tabs.Panel value="trace" pt="md">
              <Stack gap="sm">
                <Select
                  label="Preview for user"
                  data={userOptions}
                  value={previewUserId}
                  onChange={setPreviewUserId}
                  searchable
                  clearable
                  placeholder="Select a user…"
                />
                {previewUserId && (
                  <>
                    <Select
                      label="Permission to trace"
                      data={SAMPLE_PERMISSIONS}
                      value={previewPermission}
                      onChange={(v) => { if (v) setPreviewPermission(v); }}
                    />
                    <PermissionPathTrace
                      userId={previewUserId}
                      tenantId={previewTenantId}
                      permission={previewPermission}
                    />
                  </>
                )}
                {!previewUserId && (
                  <Text size="sm" c="dimmed">
                    Select a user to trace effective permissions.
                  </Text>
                )}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </Tabs.Panel>
      </Tabs>

      <Divider />

      {saveError && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
          {saveError}
        </Alert>
      )}

      <Group justify="flex-end">
        <Button onClick={() => void handleSaveAll()} loading={saving}>
          Save changes
        </Button>
      </Group>
    </Stack>
  );
}
