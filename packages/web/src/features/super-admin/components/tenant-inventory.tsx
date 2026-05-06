/**
 * <TenantInventory> — super-admin view of all tenants.
 *
 * Features:
 *   - Filter by plan (community / pro / enterprise)
 *   - Search by slug or name
 *   - Tenant detail drawer (quick info + "Open in tenant" button)
 *   - Create tenant drawer
 *   - Delete tenant drawer (slug-confirmed destructive action)
 *   - Admin audit emission on create and delete
 *
 * spec §8.1 §8.4 / Task 1d.78 / Plan 11
 */
import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Stack,
  Title,
  Group,
  Button,
  Drawer,
  TextInput,
  Select,
  Text,
  Alert,
  Badge,
  Divider,
  SimpleGrid,
  Box,
} from '@mantine/core';
import { useDisclosure, useDebouncedValue } from '@mantine/hooks';
import { useForm } from '@mantine/form';
import {
  IconBuilding,
  IconPlus,
  IconTrash,
  IconAlertTriangle,
  IconSearch,
  IconExternalLink,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useMockStore } from '@/api/mock-store';
import { logAdminAuditEntry } from '@/api/resources/audit';
import { makeIdFactory } from '@/lib/id-generator';
import type { Tenant } from '@/api/resources';

const nextTenantId = makeIdFactory('tenant-new');

const PLAN_COLORS: Record<string, string> = {
  community: 'blue',
  pro: 'violet',
  enterprise: 'orange',
};

// ─── Detail drawer ────────────────────────────────────────────────────────────

function TenantDetailDrawer({
  tenant,
  memberCount,
  onClose,
}: {
  tenant: Tenant | null;
  memberCount: number;
  onClose: () => void;
}) {
  if (!tenant) return null;

  const adminUrl =
    tenant.url_mode === 'subdomain'
      ? `https://${tenant.slug}.example.com/admin`
      : `/t/${tenant.slug}/admin`;

  return (
    <>
      <SimpleGrid cols={2} spacing="xs" mb="md">
        <Box>
          <Text size="xs" c="dimmed">
            Slug
          </Text>
          <Text size="sm" ff="monospace">
            {tenant.slug}
          </Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            Name
          </Text>
          <Text size="sm">{tenant.name}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            Plan
          </Text>
          <Badge color={PLAN_COLORS[tenant.plan] ?? 'gray'} variant="light" size="sm">
            {tenant.plan}
          </Badge>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            URL mode
          </Text>
          <Badge variant="outline" size="sm">
            {tenant.url_mode}
          </Badge>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            Members (active)
          </Text>
          <Text size="sm">{memberCount}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            Created
          </Text>
          <Text size="sm">{new Date(tenant.created_at).toLocaleDateString()}</Text>
        </Box>
      </SimpleGrid>
      <Divider mb="md" />
      <Button
        leftSection={<IconExternalLink size={14} />}
        component="a"
        href={adminUrl}
        variant="light"
        fullWidth
        data-testid="open-in-tenant-btn"
      >
        Open in tenant
      </Button>
      <Button variant="default" fullWidth mt="xs" onClick={onClose}>
        Close
      </Button>
    </>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────────

interface CreateTenantFormValues {
  slug: string;
  name: string;
  plan: 'community' | 'pro' | 'enterprise';
}

function CreateTenantForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const currentUserId = useMockStore((s) => s.currentUserId);

  const form = useForm<CreateTenantFormValues>({
    initialValues: { slug: '', name: '', plan: 'community' },
    validate: {
      slug: (v) => (v.trim().length < 2 ? 'Slug must be at least 2 characters' : null),
      name: (v) => (v.trim().length < 2 ? 'Name must be at least 2 characters' : null),
    },
  });

  function handleSubmit(values: CreateTenantFormValues) {
    setSaving(true);
    const slug = values.slug.toLowerCase().trim();
    const tenant: Tenant = {
      id: nextTenantId(),
      slug,
      name: values.name.trim(),
      accent: '#22c55e',
      plan: values.plan,
      url_mode: 'path',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    useMockStore.getState().addEntity('tenants', tenant);
    void logAdminAuditEntry({
      tenant_id: tenant.id,
      actor_id: currentUserId ?? 'unknown',
      action: 'tenant:create',
      resource_type: 'tenant',
      resource_id: tenant.id,
      tier: 'write',
      payload: { slug: tenant.slug, plan: tenant.plan },
    });
    setSaving(false);
    onSuccess();
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="md">
        <TextInput
          label="Slug"
          placeholder="my-tenant"
          description="Unique identifier used in URLs (lowercase, no spaces)"
          required
          {...form.getInputProps('slug')}
        />
        <TextInput
          label="Name"
          placeholder="My Tenant Corp"
          required
          {...form.getInputProps('name')}
        />
        <Select
          label="Plan"
          data={[
            { value: 'community', label: 'Community' },
            { value: 'pro', label: 'Pro' },
            { value: 'enterprise', label: 'Enterprise' },
          ]}
          {...form.getInputProps('plan')}
        />
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create tenant
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

function DeleteTenantConfirm({
  tenant,
  onSuccess,
  onCancel,
}: {
  tenant: Tenant;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const currentUserId = useMockStore((s) => s.currentUserId);

  const match = typed === tenant.slug;

  function handleDelete() {
    if (!match) return;
    useMockStore.getState().deleteEntity('tenants', tenant.id);
    void logAdminAuditEntry({
      tenant_id: tenant.id,
      actor_id: currentUserId ?? 'unknown',
      action: 'tenant:delete',
      resource_type: 'tenant',
      resource_id: tenant.id,
      tier: 'destructive',
      payload: { slug: tenant.slug },
    });
    onSuccess();
  }

  return (
    <Stack gap="md">
      <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Delete tenant">
        This action is irreversible. All tenant data will be removed from the mock store.
      </Alert>
      <Text size="sm">
        Type <strong>{tenant.slug}</strong> to confirm deletion.
      </Text>
      <TextInput
        placeholder={tenant.slug}
        value={typed}
        onChange={(e) => {
          setTyped(e.currentTarget.value);
        }}
        data-testid="delete-confirm-input"
      />
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="red.8" disabled={!match} onClick={handleDelete}>
          Delete tenant
        </Button>
      </Group>
    </Stack>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TenantInventory() {
  const tenants = useMockStore((s) => s.tenants);
  const memberships = useMockStore((s) => s.memberships);

  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [detailTarget, setDetailTarget] = useState<Tenant | null>(null);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchInput, 250);

  // Compute member counts per tenant
  const memberCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of Object.values(memberships)) {
      if (m.state === 'active') {
        counts[m.tenant_id] = (counts[m.tenant_id] ?? 0) + 1;
      }
    }
    return counts;
  }, [memberships]);

  const tenantList = useMemo(() => {
    return Object.values(tenants).filter((t) => {
      if (planFilter !== 'all' && t.plan !== planFilter) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        if (!t.slug.toLowerCase().includes(q) && !t.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tenants, planFilter, debouncedSearch]);

  const columns: ColumnDef<Tenant>[] = [
    {
      accessorKey: 'slug',
      header: 'Slug',
      cell: (info) => (
        <Text size="sm" ff="monospace">
          {info.getValue<string>()}
        </Text>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Name',
    },
    {
      accessorKey: 'plan',
      header: 'Plan',
      cell: (info) => (
        <Badge color={PLAN_COLORS[info.getValue<string>()] ?? 'gray'} variant="light" size="sm">
          {info.getValue<string>()}
        </Badge>
      ),
    },
    {
      accessorKey: 'url_mode',
      header: 'URL mode',
      cell: (info) => (
        <Badge variant="outline" size="sm">
          {info.getValue<string>()}
        </Badge>
      ),
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
      cell: (info) => new Date(info.getValue<string>()).toLocaleDateString(),
    },
    {
      id: 'members',
      header: 'Members',
      cell: (info) => memberCounts[info.row.original.id] ?? 0,
    },
    {
      id: 'actions',
      header: '',
      cell: (info) => (
        <Group gap={4} wrap="nowrap">
          <Button
            size="xs"
            variant="subtle"
            onClick={(e) => {
              e.stopPropagation();
              setDetailTarget(info.row.original);
            }}
            aria-label={`View ${info.row.original.slug}`}
          >
            View
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="red.8"
            leftSection={<IconTrash size={12} />}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(info.row.original);
            }}
            aria-label={`Delete ${info.row.original.slug}`}
          >
            Delete
          </Button>
        </Group>
      ),
    },
  ];

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Tenants</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          Create tenant
        </Button>
      </Group>

      {/* Filters */}
      <Group gap="sm">
        <TextInput
          placeholder="Search by slug or name…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.currentTarget.value);
          }}
          style={{ flex: 1 }}
          data-testid="tenant-search"
        />
        <Select
          placeholder="Filter by plan"
          data={[
            { value: 'all', label: 'All plans' },
            { value: 'community', label: 'Community' },
            { value: 'pro', label: 'Pro' },
            { value: 'enterprise', label: 'Enterprise' },
          ]}
          value={planFilter}
          onChange={(v) => {
            setPlanFilter(v ?? 'all');
          }}
          clearable={false}
          style={{ minWidth: 150 }}
          data-testid="plan-filter"
        />
      </Group>

      {tenantList.length === 0 ? (
        !debouncedSearch && planFilter === 'all' ? (
          <EmptyState
            icon={IconBuilding}
            title="No tenants"
            description="Create a tenant to get started."
            action={{ label: 'Create tenant', onClick: openCreate }}
          />
        ) : (
          <EmptyState
            icon={IconBuilding}
            title="No tenants"
            description="No tenants match the current filters."
          />
        )
      ) : (
        <DataTable columns={columns} data={tenantList} />
      )}

      {/* Create drawer */}
      <Drawer
        opened={createOpened}
        onClose={closeCreate}
        title="Create tenant"
        position="right"
        size="md"
        padding="md"
      >
        <CreateTenantForm onSuccess={closeCreate} onCancel={closeCreate} />
      </Drawer>

      {/* Detail drawer */}
      <Drawer
        opened={detailTarget !== null}
        onClose={() => {
          setDetailTarget(null);
        }}
        title={detailTarget ? `Tenant: ${detailTarget.slug}` : 'Tenant detail'}
        position="right"
        size="md"
        padding="md"
      >
        <TenantDetailDrawer
          tenant={detailTarget}
          memberCount={detailTarget ? (memberCounts[detailTarget.id] ?? 0) : 0}
          onClose={() => {
            setDetailTarget(null);
          }}
        />
      </Drawer>

      {/* Delete drawer */}
      <Drawer
        opened={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
        }}
        title="Delete tenant"
        position="right"
        size="md"
        padding="md"
      >
        {deleteTarget && (
          <DeleteTenantConfirm
            tenant={deleteTarget}
            onSuccess={() => {
              setDeleteTarget(null);
            }}
            onCancel={() => {
              setDeleteTarget(null);
            }}
          />
        )}
      </Drawer>
    </Stack>
  );
}
