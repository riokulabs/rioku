/**
 * Access policies page — /t/$tenant/security/access-policies
 *
 * Mounts <AccessPolicyList>. Row click opens a side Drawer showing
 * <AccessPolicyDetail> or <AccessPolicyEditor> depending on mode.
 * "Create" button opens the editor drawer in create mode.
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
import type { AccessPolicy } from '@/features/security/access-policies';
import type { AccessPolicyFormValues } from '@/features/security/access-policies';

// ─── Drawer mode ──────────────────────────────────────────────────────────────

type DrawerMode = 'detail' | 'create' | 'edit';

// ─── Page component ───────────────────────────────────────────────────────────

function AccessPoliciesPage() {
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
      ? 'Create access policy'
      : drawerMode === 'edit'
        ? `Edit — ${selectedPolicy?.name ?? ''}`
        : (selectedPolicy?.name ?? 'Policy detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Access policies</Title>
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

export const Route = createFileRoute('/t/$tenant/security/access-policies')({
  component: AccessPoliciesPage,
});
