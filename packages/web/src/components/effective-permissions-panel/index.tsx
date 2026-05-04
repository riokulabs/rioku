/**
 * <EffectivePermissionsPanel> — at-a-glance view of ALL computed permissions
 * for a user or role, with per-permission source attribution.
 *
 * Shows:
 *   - Full computed permission list (merged from direct grants + inherited
 *     parent role grants + RBAC policy grants)
 *   - Source badges per permission: "direct", "inherited from <role>",
 *     "via policy <name>"
 *   - TextInput to filter by permission substring
 *   - Optional group-by-prefix toggle (All / Grouped)
 *
 * Usage:
 *   <EffectivePermissionsPanel scope="user" id={userId} tenantId={tenantId} />
 *   <EffectivePermissionsPanel scope="role" id={roleId} />
 *
 * When scope === "role", tenantId is not used (role resolution is graph-only).
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
import {
  IconSearch,
  IconShield,
  IconArrowRight,
  IconLink,
  IconAlertCircle,
} from '@tabler/icons-react';
import { useMockStore } from '../../api/mock-store';
import {
  resolveEffectiveRolePerms,
  resolveEffectiveUserPerms,
} from '../../features/security/shared/resolve-effective-perms';
import type {
  ResolvedGrant,
  GrantSource,
} from '../../features/security/shared/resolve-effective-perms';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EffectivePermissionsPanelProps {
  scope: 'user' | 'role';
  /** User ID (when scope === 'user') or Role ID (when scope === 'role'). */
  id: string;
  /** Required when scope === 'user'. */
  tenantId?: string;
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: GrantSource }) {
  if (source.type === 'direct') {
    return (
      <Tooltip label={`Direct grant on role "${source.roleName}"`} withArrow>
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
          direct · {source.roleName}
        </Badge>
      </Tooltip>
    );
  }

  if (source.type === 'parent-role') {
    return (
      <Tooltip label={`Inherited from parent role "${source.roleName}"`} withArrow>
        <Badge
          size="xs"
          color="blue"
          variant="light"
          leftSection={
            <ThemeIcon size={10} variant="transparent" color="blue">
              <IconArrowRight size={10} />
            </ThemeIcon>
          }
        >
          inherited · {source.roleName}
        </Badge>
      </Tooltip>
    );
  }

  // rbac-policy
  return (
    <Tooltip
      label={`Added via RBAC policy "${source.policyName ?? source.policyId ?? 'unknown'}" → role "${source.roleName}"`}
      withArrow
    >
      <Badge
        size="xs"
        color="violet"
        variant="light"
        leftSection={
          <ThemeIcon size={10} variant="transparent" color="violet">
            <IconLink size={10} />
          </ThemeIcon>
        }
      >
        policy · {source.policyName ?? source.policyId}
      </Badge>
    </Tooltip>
  );
}

// ─── Condition badge ──────────────────────────────────────────────────────────

function ConditionBadge({ condition }: { condition: string }) {
  return (
    <Tooltip label={`Conditional grant — CEL: ${condition}`} multiline maw={280} withArrow>
      <Badge size="xs" color="yellow" variant="outline" style={{ cursor: 'help' }}>
        conditional
      </Badge>
    </Tooltip>
  );
}

// ─── Table view ───────────────────────────────────────────────────────────────

function PermissionsTable({ grants }: { grants: ResolvedGrant[] }) {
  if (grants.length === 0) {
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
        {grants.map((grant) => (
          <Table.Tr key={grant.permission} data-testid={`perm-row-${grant.permission}`}>
            <Table.Td>
              <Text size="xs" ff="monospace" fw={500}>
                {grant.permission}
              </Text>
            </Table.Td>
            <Table.Td>
              <Group gap={4} wrap="wrap">
                {grant.sources.map((source, idx) => (
                  <SourceBadge
                    key={`${source.roleId}-${source.type}-${String(idx)}`}
                    source={source}
                  />
                ))}
                {/* Show conditional badge if any source has a condition */}
                {grant.sources.some((s) => s.condition) && (
                  <ConditionBadge
                    condition={grant.sources.find((s) => s.condition)?.condition ?? ''}
                  />
                )}
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// ─── Grouped view ─────────────────────────────────────────────────────────────

function PermissionsGrouped({ grants }: { grants: ResolvedGrant[] }) {
  if (grants.length === 0) {
    return (
      <Text size="sm" c="var(--mantine-color-gray-7)" ta="center" py="md">
        No permissions match.
      </Text>
    );
  }

  // Group by prefix (everything before the first ':' or '*', else 'other')
  const groups = new Map<string, ResolvedGrant[]>();
  for (const grant of grants) {
    const colonIdx = grant.permission.indexOf(':');
    const prefix = colonIdx > -1 ? grant.permission.slice(0, colonIdx) : 'other';
    const group = groups.get(prefix) ?? [];
    group.push(grant);
    groups.set(prefix, group);
  }

  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Accordion multiple variant="separated" chevronPosition="left">
      {sortedGroups.map(([prefix, groupGrants]) => (
        <Accordion.Item key={prefix} value={prefix}>
          <Accordion.Control>
            <Group gap="xs">
              <Text size="sm" fw={600} ff="monospace">
                {prefix}:*
              </Text>
              <Badge size="xs" variant="outline" color="gray">
                {groupGrants.length}
              </Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <PermissionsTable grants={groupGrants} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EffectivePermissionsPanel({ scope, id, tenantId }: EffectivePermissionsPanelProps) {
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');

  const allRoles = useMockStore((s) => s.roles);
  const memberships = useMockStore((s) => s.memberships);
  const rbacPolicies = useMockStore((s) => s.rbacPolicies);

  const allGrants = useMemo<ResolvedGrant[]>(() => {
    if (scope === 'role') {
      return resolveEffectiveRolePerms(id, allRoles);
    }

    if (!tenantId) return [];
    return resolveEffectiveUserPerms(id, tenantId, allRoles, memberships, rbacPolicies);
  }, [scope, id, tenantId, allRoles, memberships, rbacPolicies]);

  const filteredGrants = useMemo(() => {
    if (!filter.trim()) return allGrants;
    const lower = filter.toLowerCase();
    return allGrants.filter((g) => g.permission.toLowerCase().includes(lower));
  }, [allGrants, filter]);

  if (scope === 'user' && !tenantId) {
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
            {allGrants.length} effective permission{allGrants.length !== 1 ? 's' : ''}
          </Text>
          {filter && filteredGrants.length !== allGrants.length && (
            <Badge size="xs" variant="outline" color="gray">
              {filteredGrants.length} shown
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
      {allGrants.length === 0 && (
        <Box py="md">
          <Text size="sm" c="var(--mantine-color-gray-7)" ta="center">
            No effective permissions found. Assign a role to this{' '}
            {scope === 'user' ? 'user' : 'role'}.
          </Text>
        </Box>
      )}

      {/* Permissions list */}
      {allGrants.length > 0 && viewMode === 'flat' && <PermissionsTable grants={filteredGrants} />}
      {allGrants.length > 0 && viewMode === 'grouped' && (
        <PermissionsGrouped grants={filteredGrants} />
      )}
    </Stack>
  );
}
