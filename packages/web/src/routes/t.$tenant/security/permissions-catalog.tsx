/**
 * Permissions catalog page — /t/$tenant/security/permissions-catalog
 *
 * Lists every permission known to the daemon, with `source` column +
 * source filter dropdown + free-text search.
 *
 * Currently backed by the mock-store catalog via `usePermissionsCatalog`.
 * Will flip to a real daemon endpoint once `GET /api/v1/permissions` is
 * exposed.
 */
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, TextInput, Select, Badge, Text, Table, Card } from '@mantine/core';
import { IconSearch, IconKey } from '@tabler/icons-react';
import { usePermissionsCatalog } from '@/hooks/use-permissions-catalog';
import { requirePermissions } from '@/hooks/use-before-load';
import type { Permission } from '@/api/resources';

type SourceFilter = 'all' | Permission['source'];

const SOURCE_LABELS: Record<Permission['source'], string> = {
  'built-in': 'Built-in',
  'plugin-manifest': 'Plugin (manifest)',
  'plugin-dynamic': 'Plugin (dynamic)',
};

const SOURCE_COLORS: Record<Permission['source'], string> = {
  'built-in': 'blue',
  'plugin-manifest': 'grape',
  'plugin-dynamic': 'orange',
};

export function PermissionSourceBadge({ source }: { source: Permission['source'] }) {
  return (
    <Badge color={SOURCE_COLORS[source]} variant="light" size="sm">
      {SOURCE_LABELS[source]}
    </Badge>
  );
}

export function PermissionsCatalogPage() {
  const { all } = usePermissionsCatalog();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((p) => {
      if (sourceFilter !== 'all' && p.source !== sourceFilter) return false;
      if (q) {
        return p.key.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [all, search, sourceFilter]);

  return (
    <Stack gap="md" p="md" data-testid="permissions-catalog-page">
      <Group gap="xs">
        <IconKey size={20} />
        <Title order={2}>Permissions catalog</Title>
      </Group>

      <Text size="sm" c="dimmed">
        Every permission known to the daemon. Built-in permissions ship with Rioku; plugin
        permissions come from installed plugins (manifest-declared) or are registered dynamically at
        runtime.
      </Text>

      <Group gap="md" align="flex-end">
        <TextInput
          placeholder="Search by key or description"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
          }}
          style={{ flex: 1 }}
          data-testid="permissions-catalog-search"
        />
        <Select
          label="Source"
          value={sourceFilter}
          onChange={(v) => {
            setSourceFilter((v as SourceFilter | null) ?? 'all');
          }}
          data={[
            { value: 'all', label: 'All sources' },
            { value: 'built-in', label: SOURCE_LABELS['built-in'] },
            { value: 'plugin-manifest', label: SOURCE_LABELS['plugin-manifest'] },
            { value: 'plugin-dynamic', label: SOURCE_LABELS['plugin-dynamic'] },
          ]}
          data-testid="permissions-catalog-source-filter"
        />
      </Group>

      <Card withBorder padding={0}>
        <Table striped highlightOnHover stickyHeader aria-label="Permissions catalog">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Key</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th style={{ width: 160 }}>Source</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={3}>
                  <Text c="dimmed" ta="center" py="md">
                    No permissions match the current filters.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              filtered.map((p) => (
                <Table.Tr key={p.key} data-testid={`perm-row-${p.key}`}>
                  <Table.Td>
                    <Text ff="monospace" size="sm">
                      {p.key}
                    </Text>
                  </Table.Td>
                  <Table.Td>{p.description}</Table.Td>
                  <Table.Td>
                    <PermissionSourceBadge source={p.source} />
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Card>

      <Text size="xs" c="dimmed">
        Showing {String(filtered.length)} of {String(all.length)} permissions.
      </Text>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/permissions-catalog')({
  beforeLoad: requirePermissions({ required: ['role:read'] }),
  component: PermissionsCatalogPage,
});
