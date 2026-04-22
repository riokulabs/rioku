/**
 * RBAC policies page — /t/$tenant/security/rbac-policies
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import {
  RbacPolicyList,
  RbacPolicyDetail,
  RbacPolicyEditor,
  createRbacPolicyMutation,
  updateRbacPolicyMutation,
  deleteRbacPolicyMutation,
} from '@/features/security/rbac-policies';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import type { RbacPolicyFull } from '@/features/security/rbac-policies';
import type { RbacPolicyFormValues } from '@/features/security/rbac-policies';

type DrawerMode = 'detail' | 'create' | 'edit';

function RbacPoliciesPage() {
  const { tenant } = Route.useParams();
  const tenantId = useMockStore(
    (s) => Object.values(s.tenants).find((t) => t.slug === tenant)?.id ?? '',
  );

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedPolicy, setSelectedPolicy] = useState<RbacPolicyFull | null>(null);

  function handleRowClick(policy: RbacPolicyFull) {
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

  async function handleSave(values: RbacPolicyFormValues) {
    if (drawerMode === 'create') {
      await createRbacPolicyMutation(tenantId, values);
      notify.success('Policy created', `"${values.name}" has been created.`);
    } else if (drawerMode === 'edit' && selectedPolicy) {
      await updateRbacPolicyMutation(selectedPolicy.id, values);
      notify.success('Policy updated', `"${values.name}" has been updated.`);
    }
    closeDrawer();
  }

  async function handleDelete() {
    if (!selectedPolicy) return;
    await deleteRbacPolicyMutation(selectedPolicy.id);
    notify.success('Policy deleted', `"${selectedPolicy.name}" has been deleted.`);
    closeDrawer();
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create RBAC policy'
      : drawerMode === 'edit'
        ? `Edit — ${selectedPolicy?.name ?? ''}`
        : (selectedPolicy?.name ?? 'Policy detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>RBAC policies</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          Create policy
        </Button>
      </Group>

      <RbacPolicyList onSelect={handleRowClick} />

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="min(400px, 95vw)"
        padding="md"
      >
        {drawerMode === 'detail' && selectedPolicy && (
          <RbacPolicyDetail
            policy={selectedPolicy}
            onEdit={handleEdit}
            onDelete={() => void handleDelete()}
          />
        )}
        {(drawerMode === 'create' || drawerMode === 'edit') && (
          <RbacPolicyEditor
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

export const Route = createFileRoute('/t/$tenant/security/rbac-policies')({
  beforeLoad: requirePermissions({ required: ['rbac-policy:read'] }),
  component: RbacPoliciesPage,
});
