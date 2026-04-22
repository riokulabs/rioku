/**
 * Policies page — /t/$tenant/policies (API-management entry point)
 *
 * Per spec §7.4 ("one engine, two UIs"), Access Policies and the per-route
 * Policies list share the same underlying AccessPolicy resource. The only
 * distinction is navigation context — this route surfaces the same UI under
 * the "API management" sidebar group, while the /security/access-policies
 * route keeps an entry under "Security".
 *
 * Implementation: renders the same list+detail+editor composition as the
 * security page.
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import {
  AccessPolicyList,
  AccessPolicyDetail,
  AccessPolicyEditor,
  createAccessPolicyMutation,
  updateAccessPolicyMutation,
  deleteAccessPolicyMutation,
} from '@/features/security/access-policies';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import type { AccessPolicy } from '@/features/security/access-policies';
import type { AccessPolicyFormValues } from '@/features/security/access-policies';

type DrawerMode = 'detail' | 'create' | 'edit';

function PoliciesPage() {
  const { tenant } = Route.useParams();
  const tenantId = useMockStore(
    (s) => Object.values(s.tenants).find((t) => t.slug === tenant)?.id ?? '',
  );

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedPolicy, setSelectedPolicy] = useState<AccessPolicy | null>(null);

  function handleRowClick(policy: AccessPolicy) {
    setSelectedPolicy(policy);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedPolicy(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEdit() {
    setDrawerMode('edit');
  }

  async function handleSave(values: AccessPolicyFormValues) {
    if (drawerMode === 'create') {
      await createAccessPolicyMutation(tenantId, values);
      notify.success('Policy created', `"${values.name}" has been created.`);
    } else if (drawerMode === 'edit' && selectedPolicy) {
      await updateAccessPolicyMutation(selectedPolicy.id, values);
      notify.success('Policy updated', `"${values.name}" has been updated.`);
    }
    closeDrawer();
  }

  async function handleDelete() {
    if (!selectedPolicy) return;
    await deleteAccessPolicyMutation(selectedPolicy.id);
    notify.success('Policy deleted', `"${selectedPolicy.name}" has been deleted.`);
    closeDrawer();
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create policy'
      : drawerMode === 'edit'
        ? `Edit — ${selectedPolicy?.name ?? ''}`
        : (selectedPolicy?.name ?? 'Policy detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Policies</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          Create policy
        </Button>
      </Group>

      <AccessPolicyList onSelect={handleRowClick} />

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="min(400px, 95vw)"
        padding="md"
      >
        {drawerMode === 'detail' && selectedPolicy && (
          <AccessPolicyDetail
            policy={selectedPolicy}
            onEdit={handleEdit}
            onDelete={() => void handleDelete()}
          />
        )}
        {(drawerMode === 'create' || drawerMode === 'edit') && (
          <AccessPolicyEditor
            {...(drawerMode === 'edit' && selectedPolicy ? { initial: selectedPolicy } : {})}
            tenantId={tenantId}
            onSave={handleSave}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/policies')({
  beforeLoad: requirePermissions({ required: ['policy:read'] }),
  component: PoliciesPage,
});
