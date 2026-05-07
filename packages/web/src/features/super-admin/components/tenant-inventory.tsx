/**
 * <TenantInventory> — super-admin view of all tenants.
 *
 * Plan 11 close-out: now consumes real daemon endpoints via the Orval-generated
 * `useListAdminTenants` / `useCreateAdminTenant` / `useDeleteAdminTenant` hooks.
 * The mock-store prime path is gone — tests stub the network layer with MSW.
 *
 * Features:
 *   - Filter by plan (community / pro / enterprise)
 *   - Search by slug or name
 *   - Tenant detail drawer (quick info + "Open in tenant" button)
 *   - Create tenant drawer
 *   - Delete tenant drawer (slug-confirmed destructive action)
 *
 * spec §8.1 §8.4 / Task 1d.78 / Plan 11
 */
import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
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
  Loader,
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
import {
  useListAdminTenants,
  useCreateAdminTenant,
  useDeleteAdminTenant,
  getListAdminTenantsQueryKey,
} from '@/api/generated/admin/admin';
import type { AdminTenant } from '@/api/generated/schemas';

const PLAN_COLORS: Record<string, string> = {
  community: 'blue',
  pro: 'violet',
  enterprise: 'orange',
};

// ─── Detail drawer ────────────────────────────────────────────────────────────

function TenantDetailDrawer({
  tenant,
  onClose,
}: {
  tenant: AdminTenant | null;
  onClose: () => void;
}) {
  if (!tenant) return null;

  const slug = tenant.slug ?? '';
  const adminUrl =
    tenant.urlMode === 'subdomain'
      ? `https://${slug}.example.com/admin`
      : `/t/${slug}/admin`;

  return (
    <>
      <SimpleGrid cols={2} spacing="xs" mb="md">
        <Box>
          <Text size="xs" c="dimmed">
            Slug
          </Text>
          <Text size="sm" ff="monospace">
            {slug}
          </Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            Name
          </Text>
          <Text size="sm">{tenant.name ?? '—'}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            Plan
          </Text>
          <Badge color={PLAN_COLORS[tenant.plan ?? ''] ?? 'gray'} variant="light" size="sm">
            {tenant.plan ?? '—'}
          </Badge>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            URL mode
          </Text>
          <Badge variant="outline" size="sm">
            {tenant.urlMode ?? '—'}
          </Badge>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            ID
          </Text>
          <Text size="xs" ff="monospace">
            {tenant.id ?? '—'}
          </Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">
            Created
          </Text>
          <Text size="sm">
            {tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : '—'}
          </Text>
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
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const createMut = useCreateAdminTenant({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListAdminTenantsQueryKey() });
        onSuccess();
      },
      onError: (err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to create tenant');
      },
    },
  });

  const form = useForm<CreateTenantFormValues>({
    initialValues: { slug: '', name: '', plan: 'community' },
    validate: {
      slug: (v) => (v.trim().length < 2 ? 'Slug must be at least 2 characters' : null),
      name: (v) => (v.trim().length < 2 ? 'Name must be at least 2 characters' : null),
    },
  });

  function handleSubmit(values: CreateTenantFormValues) {
    setErrorMsg(null);
    createMut.mutate({
      data: {
        slug: values.slug.toLowerCase().trim(),
        name: values.name.trim(),
        plan: values.plan,
      },
    });
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
        {errorMsg !== null && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            {errorMsg}
          </Alert>
        )}
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onCancel} disabled={createMut.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={createMut.isPending}>
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
  tenant: AdminTenant;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const deleteMut = useDeleteAdminTenant({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListAdminTenantsQueryKey() });
        onSuccess();
      },
      onError: (err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to delete tenant');
      },
    },
  });

  const slug = tenant.slug ?? '';
  const id = tenant.id ?? '';
  const match = typed === slug && id !== '';

  function handleDelete() {
    if (!match) return;
    setErrorMsg(null);
    deleteMut.mutate({ id });
  }

  return (
    <Stack gap="md">
      <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Delete tenant">
        This action is irreversible. All tenant data will be removed.
      </Alert>
      <Text size="sm">
        Type <strong>{slug}</strong> to confirm deletion.
      </Text>
      <TextInput
        placeholder={slug}
        value={typed}
        onChange={(e) => {
          setTyped(e.currentTarget.value);
        }}
        data-testid="delete-confirm-input"
      />
      {errorMsg !== null && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {errorMsg}
        </Alert>
      )}
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onCancel} disabled={deleteMut.isPending}>
          Cancel
        </Button>
        <Button
          color="red.8"
          disabled={!match}
          loading={deleteMut.isPending}
          onClick={handleDelete}
        >
          Delete tenant
        </Button>
      </Group>
    </Stack>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TenantInventory() {
  const { data, isLoading, isError, error } = useListAdminTenants();

  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminTenant | null>(null);
  const [detailTarget, setDetailTarget] = useState<AdminTenant | null>(null);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchInput, 250);

  const tenants = useMemo<AdminTenant[]>(() => data?.data.items ?? [], [data]);

  const tenantList = useMemo(() => {
    return tenants.filter((t) => {
      if (planFilter !== 'all' && t.plan !== planFilter) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const slug = (t.slug ?? '').toLowerCase();
        const name = (t.name ?? '').toLowerCase();
        if (!slug.includes(q) && !name.includes(q)) return false;
      }
      return true;
    });
  }, [tenants, planFilter, debouncedSearch]);

  const columns: ColumnDef<AdminTenant>[] = [
    {
      accessorKey: 'slug',
      header: 'Slug',
      cell: (info) => (
        <Text size="sm" ff="monospace">
          {info.getValue<string | undefined>() ?? '—'}
        </Text>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: (info) => info.getValue<string | undefined>() ?? '—',
    },
    {
      accessorKey: 'plan',
      header: 'Plan',
      cell: (info) => {
        const v = info.getValue<string | undefined>() ?? '';
        return (
          <Badge color={PLAN_COLORS[v] ?? 'gray'} variant="light" size="sm">
            {v || '—'}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'urlMode',
      header: 'URL mode',
      cell: (info) => (
        <Badge variant="outline" size="sm">
          {info.getValue<string | undefined>() ?? '—'}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: (info) => {
        const v = info.getValue<string | undefined>();
        return v ? new Date(v).toLocaleDateString() : '—';
      },
    },
    {
      id: 'actions',
      header: '',
      cell: (info) => {
        const slug = info.row.original.slug ?? '';
        return (
          <Group gap={4} wrap="nowrap">
            <Button
              size="xs"
              variant="subtle"
              onClick={(e) => {
                e.stopPropagation();
                setDetailTarget(info.row.original);
              }}
              aria-label={`View ${slug}`}
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
              aria-label={`Delete ${slug}`}
            >
              Delete
            </Button>
          </Group>
        );
      },
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

      {isLoading ? (
        <Group justify="center" p="xl">
          <Loader data-testid="tenant-list-loading" />
        </Group>
      ) : isError ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed to load tenants">
          {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      ) : tenantList.length === 0 ? (
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
        title={detailTarget ? `Tenant: ${detailTarget.slug ?? ''}` : 'Tenant detail'}
        position="right"
        size="md"
        padding="md"
      >
        <TenantDetailDrawer
          tenant={detailTarget}
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
