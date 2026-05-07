/**
 * Policies page — /t/$tenant/policies (API-management entry point)
 *
 * Wired to real daemon endpoints in stage-2 plan-02.
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import {
  AccessPolicyList,
  AccessPolicyDrawer,
  AccessPolicyEditor,
  useCreateAccessPolicyMutation,
  useUpdateAccessPolicyMutation,
  useDeleteAccessPolicyMutation,
} from '@/features/security/access-policies';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import type { AccessPolicy } from '@/features/security/access-policies';
import type { AccessPolicyFormValues } from '@/features/security/access-policies';

type DrawerMode = 'detail' | 'create' | 'edit';

function PoliciesPage() {
  const { tenant } = Route.useParams();
  const createMutation = useCreateAccessPolicyMutation(tenant);
  const updateMutation = useUpdateAccessPolicyMutation(tenant);
  const deleteMutation = useDeleteAccessPolicyMutation(tenant);

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
      await createMutation(values);
      notify.success('Policy created', `"${values.name}" has been created.`);
    } else if (drawerMode === 'edit' && selectedPolicy) {
      await updateMutation(selectedPolicy.id, values);
      notify.success('Policy updated', `"${values.name}" has been updated.`);
    }
    closeDrawer();
  }
  async function handleDelete() {
    if (!selectedPolicy) return;
    await deleteMutation(selectedPolicy.id);
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

      <AccessPolicyList tenant={tenant} onSelect={handleRowClick} />

      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="min(420px, 95vw)"
        padding="md"
      >
        {drawerMode === 'detail' && selectedPolicy && (
          <AccessPolicyDrawer
            policy={selectedPolicy}
            tenantSlug={tenant}
            onEdit={handleEdit}
            onDelete={() => void handleDelete()}
          />
        )}
        {(drawerMode === 'create' || drawerMode === 'edit') && (
          <AccessPolicyEditor
            {...(drawerMode === 'edit' && selectedPolicy ? { initial: selectedPolicy } : {})}
            tenantId={tenant}
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
