/**
 * <TenantInventory> — super-admin view of all tenants with create/delete actions.
 *
 * spec §8.1 / Task 1d.78
 */
import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Stack, Title, Group, Button, Drawer, TextInput, Text, Alert } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useForm } from '@mantine/form';
import { IconBuilding, IconPlus, IconTrash, IconAlertTriangle } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useMockStore } from '@/api/mock-store';
import { makeIdFactory } from '@/lib/id-generator';
import type { Tenant } from '@/api/resources/types';

const nextTenantId = makeIdFactory('tenant-new');

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

  const match = typed === tenant.slug;

  function handleDelete() {
    if (!match) return;
    useMockStore.getState().deleteEntity('tenants', tenant.id);
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
        <Button color="red" disabled={!match} onClick={handleDelete}>
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

  const tenantList = useMemo(() => Object.values(tenants), [tenants]);

  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);

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
        <Button
          size="xs"
          variant="subtle"
          color="red"
          leftSection={<IconTrash size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(info.row.original);
          }}
          aria-label={`Delete ${info.row.original.slug}`}
        >
          Delete
        </Button>
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

      {tenantList.length === 0 ? (
        <EmptyState
          icon={IconBuilding}
          title="No tenants"
          description="Create a tenant to get started."
          action={{ label: 'Create tenant', onClick: openCreate }}
        />
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
