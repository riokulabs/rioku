/**
 * <EffectivePermissionsPanel> — at-a-glance view of the daemon-resolved
 * permissions for a user or role.
 *
 * Stage-2: the daemon flattens role inheritance + denies + RBAC policies
 * before returning, so per-source attribution beyond "direct grant" is
 * not exposed in the wire shape. We surface what the daemon gives us:
 *   - For `scope="user"` we list `useListUserRoles` then look up each
 *     role's flat permission array via `useListRoles(tenant)`.
 *   - For `scope="role"` we look up the single role and list its
 *     permissions.
 *
 * Features retained:
 *   - Filter input narrows the list by substring match.
 *   - SegmentedControl flips between flat and grouped (by namespace prefix).
 *   - Empty state when the role has no permissions or the user has no roles.
 */

import { useMemo, useState } from 'react';
import {
  Stack,
  Group,
  Text,
  Badge,
  TextInput,
  SegmentedControl,
  Table,
  Accordion,
  Alert,
  Tooltip,
  ThemeIcon,
  Box,
} from '@mantine/core';
import { IconSearch, IconShield, IconAlertCircle } from '@tabler/icons-react';
import { useListRoles, useListUserRoles } from '@/api/generated/roles/roles';
import { useActiveTenantSlug } from '@/hooks/use-tenant';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoleRow {
  id?: string;
  name?: string;
  permissions?: string[];
}

interface ResolvedRow {
  permission: string;
  /** Roles that directly carry this permission. */
  roles: { id: string; name: string }[];
}

export interface EffectivePermissionsPanelProps {
  scope: 'user' | 'role';
  /** User ID (when scope === 'user') or Role ID (when scope === 'role'). */
  id: string;
  /** Required when scope === 'user'. */
  tenantId?: string;
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ roleName }: { roleName: string }) {
  return (
    <Tooltip label={`Granted via role "${roleName}"`} withArrow>
      <Badge
        size="xs"
        color="green"
        variant="light"
        leftSection={
          <ThemeIcon size={10} variant="transparent" color="green">
            <IconShield size={10} />
          </ThemeIcon>
        }
      >
        {roleName}
      </Badge>
    </Tooltip>
  );
}

// ─── Table view ───────────────────────────────────────────────────────────────

function PermissionsTable({ rows }: { rows: ResolvedRow[] }) {
  if (rows.length === 0) {
    return (
      <Text size="sm" c="var(--mantine-color-gray-7)" ta="center" py="md">
        No permissions match.
      </Text>
    );
  }

  return (
    <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th w="40%">Permission</Table.Th>
          <Table.Th>Sources</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.permission} data-testid={`perm-row-${row.permission}`}>
            <Table.Td>
              <Text size="xs" ff="monospace" fw={500}>
                {row.permission}
              </Text>
            </Table.Td>
            <Table.Td>
              <Group gap={4} wrap="wrap">
                {row.roles.map((r) => (
                  <SourceBadge key={r.id} roleName={r.name} />
                ))}
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// ─── Grouped view ─────────────────────────────────────────────────────────────

function PermissionsGrouped({ rows }: { rows: ResolvedRow[] }) {
  if (rows.length === 0) {
    return (
      <Text size="sm" c="var(--mantine-color-gray-7)" ta="center" py="md">
        No permissions match.
      </Text>
    );
  }

  // Group by prefix (everything before the first ':' or '*', else 'other')
  const groups = new Map<string, ResolvedRow[]>();
  for (const row of rows) {
    const colonIdx = row.permission.indexOf(':');
    const prefix = colonIdx > -1 ? row.permission.slice(0, colonIdx) : 'other';
    const group = groups.get(prefix) ?? [];
    group.push(row);
    groups.set(prefix, group);
  }

  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Accordion multiple variant="separated" chevronPosition="left">
      {sortedGroups.map(([prefix, groupRows]) => (
        <Accordion.Item key={prefix} value={prefix}>
          <Accordion.Control>
            <Group gap="xs">
              <Text size="sm" fw={600} ff="monospace">
                {prefix}:*
              </Text>
              <Badge size="xs" variant="outline" color="gray">
                {groupRows.length}
              </Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <PermissionsTable rows={groupRows} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

function resolveRows(roles: RoleRow[]): ResolvedRow[] {
  const map = new Map<string, ResolvedRow>();
  for (const role of roles) {
    const id = role.id ?? '';
    const name = role.name ?? id;
    for (const perm of role.permissions ?? []) {
      const existing = map.get(perm);
      if (existing) {
        if (!existing.roles.some((r) => r.id === id)) existing.roles.push({ id, name });
      } else {
        map.set(perm, { permission: perm, roles: [{ id, name }] });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.permission.localeCompare(b.permission));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EffectivePermissionsPanel({ scope, id, tenantId }: EffectivePermissionsPanelProps) {
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');

  const routeTenantSlug = useActiveTenantSlug();
  const tenant = tenantId ?? routeTenantSlug ?? '';

  // Pull every role in the tenant once — we need names + permission lists
  // regardless of scope.
  const allRolesQuery = useListRoles(tenant, {
    query: { enabled: tenant !== '' },
  });
  // For user scope, also pull the user's role assignments.
  const userRolesQuery = useListUserRoles(tenant, id, {
    query: { enabled: scope === 'user' && tenant !== '' && id !== '' },
  });

  const allRolesData = allRolesQuery.data;
  const userRolesData = userRolesQuery.data;

  const rows = useMemo<ResolvedRow[]>(() => {
    const allRoles: RoleRow[] = (allRolesData?.data.roles ?? []);
    const userRoles: { id?: string; name?: string }[] = userRolesData?.data.roles ?? [];
    if (scope === 'role') {
      const role = allRoles.find((r) => r.id === id);
      if (!role) return [];
      return resolveRows([role]);
    }
    // user scope
    const assignedIds = new Set(userRoles.map((r) => r.id).filter((x): x is string => !!x));
    const assignedRoles = allRoles.filter((r) => r.id && assignedIds.has(r.id));
    return resolveRows(assignedRoles);
  }, [scope, id, allRolesData, userRolesData]);

  const filteredRows = useMemo(() => {
    if (!filter.trim()) return rows;
    const lower = filter.toLowerCase();
    return rows.filter((r) => r.permission.toLowerCase().includes(lower));
  }, [rows, filter]);

  if (scope === 'user' && tenant === '') {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light">
        tenantId is required for user scope.
      </Alert>
    );
  }

  return (
    <Stack gap="sm" data-testid="effective-permissions-panel">
      {/* Summary bar */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Text size="sm" fw={500}>
            {rows.length} effective permission{rows.length !== 1 ? 's' : ''}
          </Text>
          {filter && filteredRows.length !== rows.length && (
            <Badge size="xs" variant="outline" color="gray">
              {filteredRows.length} shown
            </Badge>
          )}
        </Group>

        <SegmentedControl
          size="xs"
          value={viewMode}
          onChange={(v) => {
            setViewMode(v === 'grouped' ? 'grouped' : 'flat');
          }}
          data={[
            { label: 'Flat', value: 'flat' },
            { label: 'Grouped', value: 'grouped' },
          ]}
        />
      </Group>

      {/* Filter */}
      <TextInput
        size="xs"
        placeholder="Filter permissions…"
        leftSection={<IconSearch size={14} />}
        value={filter}
        onChange={(e) => {
          setFilter(e.currentTarget.value);
        }}
        data-testid="perms-filter-input"
      />

      {/* Empty state */}
      {rows.length === 0 && (
        <Box py="md">
          <Text size="sm" c="var(--mantine-color-gray-7)" ta="center">
            No effective permissions found. Assign a role to this{' '}
            {scope === 'user' ? 'user' : 'role'}.
          </Text>
        </Box>
      )}

      {/* Permissions list */}
      {rows.length > 0 && viewMode === 'flat' && <PermissionsTable rows={filteredRows} />}
      {rows.length > 0 && viewMode === 'grouped' && <PermissionsGrouped rows={filteredRows} />}
    </Stack>
  );
}
