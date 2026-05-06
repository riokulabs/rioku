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
  Paper,
  Tabs,
} from '@mantine/core';
import { IconTrash, IconPlus, IconAlertCircle } from '@tabler/icons-react';
import { PermissionSelector } from '@/components/permission-selector';
import { EffectivePermissionsPanel } from '@/components/effective-permissions-panel';
import { ConditionEditor } from '@/components/condition-editor';
import { validateRoleSave } from '@/host/role-resolver';
import { useListPermissions } from '@/api/generated/permissions/permissions';
import type { Permission as GenPermission } from '@/api/generated/schemas';
import { useRoleUserCounts, useRolesMap, useRoleMutations } from '../api';
import type { Role, GrantRow } from '../types';

interface RoleDetailProps {
  tenant: string;
  role: Role;
  /** When false, mutating controls (Delete, Save, Add grant) are hidden. */
  canWrite?: boolean;
  onDelete: () => void;
  onClose: () => void;
}

// ─── Grant row editor ─────────────────────────────────────────────────────────

interface GrantRowEditorProps {
  catalog: GenPermission[];
  row: GrantRow;
  onChange: (updated: GrantRow) => void;
  onRemove: () => void;
}

function GrantRowEditor({ catalog, row, onChange, onRemove }: GrantRowEditorProps) {
  const [showCondition, setShowCondition] = useState(!!row.when);

  // RD6: surface the permission source ('built-in' / 'plugin-manifest' /
  // 'plugin-dynamic') as a small Mantine Badge next to the permission name.
  // Cross-references the live daemon catalog (useListPermissions) so a
  // grant that targets a permission no longer published by the daemon
  // renders an ORPHANED alert.
  const matched = row.permission ? catalog.find((p) => (p.id ?? '') === row.permission) : undefined;
  const isOrphan = !!row.permission && !matched;
  const sourceLabel = matched?.source ?? null;
  const sourceColor =
    sourceLabel === 'built-in'
      ? 'gray'
      : sourceLabel === 'plugin-manifest'
        ? 'blue'
        : sourceLabel === 'plugin-dynamic'
          ? 'violet'
          : 'gray';

  return (
    <Paper withBorder p="xs" radius="sm">
      <Stack gap="xs">
        <Group align="flex-end" gap="xs">
          <PermissionSelector
            value={row.permission ? [row.permission] : []}
            onChange={(v) => {
              onChange({ ...row, permission: v[0] ?? '' });
            }}
            label="Permission"
          />
          {sourceLabel && (
            <Badge
              color={sourceColor}
              variant="light"
              size="sm"
              aria-label={`Source: ${sourceLabel}`}
              data-testid="grant-source-badge"
            >
              {sourceLabel}
            </Badge>
          )}
          <ActionIcon color="red.8" variant="subtle" onClick={onRemove} aria-label="Remove grant">
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
        {isOrphan && (
          <Alert
            color="red"
            variant="light"
            icon={<IconAlertCircle size={14} />}
            data-testid="grant-orphan-alert"
          >
            ORPHANED — permission <code>{row.permission}</code> no longer exists in the catalog.
            Re-select a valid permission or remove this grant.
          </Alert>
        )}
        {!showCondition && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => {
              setShowCondition(true);
            }}
          >
            + Add condition
          </Button>
        )}
        {showCondition && (
          <ConditionEditor
            label="Condition (optional)"
            value={row.when}
            onChange={(v) => {
              onChange({ ...row, when: v });
            }}
            height={80}
          />
        )}
      </Stack>
    </Paper>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function RoleDetail({
  tenant,
  role,
  canWrite = true,
  onDelete,
  onClose: _onClose,
}: RoleDetailProps) {
  const allRoles = useRolesMap(tenant);
  const userCounts = useRoleUserCounts(tenant);
  const { update } = useRoleMutations(tenant);

  // Permission catalog — sourced from the real daemon endpoint so the
  // RD6 source badge + orphan alert reflect installed plugins, not the
  // mock store.
  const catalogQuery = useListPermissions(tenant);
  const catalog: GenPermission[] = catalogQuery.data?.data.permissions ?? [];

  // Parent editor state
  const [parentIds, setParentIds] = useState<string[]>(role.parent_ids);
  const [parentError, setParentError] = useState<string | null>(null);

  // Grants editor state
  const [grantRows, setGrantRows] = useState<GrantRow[]>(
    role.grants.map((g, i) => ({
      _key: `g-${String(i)}`,
      permission: g.permission,
      when: g.when ?? '',
    })),
  );

  // Denies editor state
  const [denies, setDenies] = useState<string[]>(role.denies);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Parent options — exclude self
  const parentOptions = Object.values(allRoles)
    .filter((r) => r.id !== role.id)
    .map((r) => ({ value: r.id, label: r.name }));

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
      await update(role.id, {
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
            {role.system && (
              <Badge color="gray" variant="outline" size="sm">
                system
              </Badge>
            )}
            <Badge color="blue" variant="light" size="sm">
              {userCount} user{userCount !== 1 ? 's' : ''}
            </Badge>
          </Group>
        </Stack>
        {canWrite && (
          <Group gap="xs">
            <Button
              size="xs"
              variant="light"
              color="red.8"
              onClick={onDelete}
              data-testid="role-delete-button"
            >
              Delete
            </Button>
          </Group>
        )}
      </Group>

      <Divider />

      <Tabs defaultValue="parents" data-testid="role-detail-tabs">
        <Tabs.List>
          <Tabs.Tab value="parents">Parents</Tabs.Tab>
          <Tabs.Tab value="grants">Grants</Tabs.Tab>
          <Tabs.Tab value="denies">Denies</Tabs.Tab>
          <Tabs.Tab value="preview">Effective Perms</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="parents" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="var(--mantine-color-gray-7)">
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
              disabled={!canWrite}
            />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="grants" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Permissions explicitly granted by this role. Inherited grants come from parent roles.
            </Text>
            {grantRows.map((row) => (
              <GrantRowEditor
                key={row._key}
                catalog={catalog}
                row={row}
                onChange={updateGrantRow}
                onRemove={() => {
                  removeGrantRow(row._key);
                }}
              />
            ))}
            {canWrite && (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={addGrantRow}
              >
                Add grant
              </Button>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="denies" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Permissions explicitly denied by this role. Denies override inherited grants.
            </Text>
            <PermissionSelector label="Denied permissions" value={denies} onChange={setDenies} />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="preview" pt="md">
          <Stack gap="xs">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Full set of permissions this role effectively grants (own grants + inherited from
              parents).
            </Text>
            <EffectivePermissionsPanel scope="role" id={role.id} />
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Divider />

      {saveError && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
          {saveError}
        </Alert>
      )}

      {canWrite && (
        <Group justify="flex-end">
          <Button
            onClick={() => void handleSaveAll()}
            loading={saving}
            data-testid="role-save-button"
          >
            Save changes
          </Button>
        </Group>
      )}
    </Stack>
  );
}
