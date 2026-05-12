/**
 * Roles page — /t/$tenant/security/roles
 *
 * Drawer-based: list → row click opens RoleDetail; "Create" opens RoleCreate.
 * Delete opens RoleDeleteConfirm inside the same drawer.
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import {
  RoleList,
  RoleDetail,
  RoleCreate,
  RoleDeleteConfirm,
  useRoleMutations,
} from '@/features/security/roles';
import { notify } from '@/hooks/use-notify';
import type { Role } from '@/api/resources';
import type { RoleCreateFormValues } from '@/features/security/roles';

type DrawerMode = 'detail' | 'create' | 'delete';

function RolesPage() {
  const { tenant } = Route.useParams();
  const { create, remove } = useRoleMutations(tenant);

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
    const role = await create({
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
    await remove(selectedRole.id);
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

      <RoleList tenant={tenant} onSelect={handleRowClick} />

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
          <RoleDetail
            tenant={tenant}
            role={selectedRole}
            onDelete={handleDeleteRequest}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <RoleCreate tenant={tenant} onSave={handleCreateSave} onCancel={closeDrawer} />
        )}
        {drawerMode === 'delete' && selectedRole && (
          <RoleDeleteConfirm
            tenant={tenant}
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
  beforeLoad: requirePermissions({ required: ['role:read'] }),
  component: RolesPage,
});
