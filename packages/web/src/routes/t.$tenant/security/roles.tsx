/**
 * Roles page — /t/$tenant/security/roles
 *
 * Drawer-based: list → row click opens RoleDetail; "Create" opens RoleCreate.
 * Delete opens RoleDeleteConfirm inside the same drawer.
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import {
  RoleList,
  RoleDetail,
  RoleCreate,
  RoleDeleteConfirm,
  createRoleMutation,
  deleteRoleMutation,
} from '@/features/security/roles';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import type { Role } from '@/api/resources/types';
import type { RoleCreateFormValues } from '@/features/security/roles';

type DrawerMode = 'detail' | 'create' | 'delete';

function RolesPage() {
  const { tenant } = Route.useParams();
  const tenantId = useMockStore(
    (s) => Object.values(s.tenants).find((t) => t.slug === tenant)?.id ?? '',
  );

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);

  function handleRowClick(role: Role) {
    setSelectedRole(role);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedRole(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleDeleteRequest() {
    setDrawerMode('delete');
  }

  async function handleCreateSave(values: RoleCreateFormValues) {
    const role = await createRoleMutation(tenantId, {
      name: values.name,
      ...(values.description ? { description: values.description } : {}),
      parent_ids: values.parent_id ? [values.parent_id] : [],
      grants: [],
      denies: [],
    });
    notify.success('Role created', `"${role.name}" has been created.`);
    closeDrawer();
  }

  async function handleDeleteConfirm() {
    if (!selectedRole) return;
    await deleteRoleMutation(selectedRole.id);
    notify.success('Role deleted', `"${selectedRole.name}" has been deleted.`);
    closeDrawer();
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create role'
      : drawerMode === 'delete'
        ? `Delete — ${selectedRole?.name ?? ''}`
        : (selectedRole?.name ?? 'Role detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Roles</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          Create role
        </Button>
      </Group>

      <RoleList onSelect={handleRowClick} />

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="min(520px, 95vw)"
        padding="md"
      >
        {drawerMode === 'detail' && selectedRole && (
          <RoleDetail role={selectedRole} onDelete={handleDeleteRequest} onClose={closeDrawer} />
        )}
        {drawerMode === 'create' && (
          <RoleCreate tenantId={tenantId} onSave={handleCreateSave} onCancel={closeDrawer} />
        )}
        {drawerMode === 'delete' && selectedRole && (
          <RoleDeleteConfirm
            role={selectedRole}
            onConfirm={handleDeleteConfirm}
            onCancel={() => {
              setDrawerMode('detail');
            }}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/roles')({
  component: RolesPage,
});
