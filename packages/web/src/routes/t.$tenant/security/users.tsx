/**
 * Users page — /t/$tenant/security/users
 *
 * Drawer-based: list → row click opens UserDetail; "Invite user" opens UserInviteForm.
 * Permission guard: requires user:read (Option A — seed sets currentUserId to admin).
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconUserPlus } from '@tabler/icons-react';
import { UserList, UserDetail, UserInviteForm } from '@/features/security/users';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { DrawerTitleExpand } from '@/components/drawer-title-expand';
import type { UserWithMembership } from '@/features/security/users';

type DrawerMode = 'detail' | 'invite';

function UsersPage() {
  const { tenant } = Route.useParams();

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;
  const navigate = useNavigate();

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedItem, setSelectedItem] = useState<UserWithMembership | null>(null);

  function handleRowClick(item: UserWithMembership) {
    setSelectedItem(item);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleInvite() {
    setSelectedItem(null);
    setDrawerMode('invite');
    openDrawer();
  }

  const drawerTitle =
    drawerMode === 'invite' ? 'Invite user' : selectedItem ? selectedItem.user.name : 'User detail';

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Users</Title>
        <Button leftSection={<IconUserPlus size={16} />} onClick={handleInvite}>
          Invite user
        </Button>
      </Group>

      <UserList tenantId={tenantId} tenantSlug={tenantSlug} onSelect={handleRowClick} />

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={
          <DrawerTitleExpand
            title={drawerTitle}
            {...(drawerMode === 'detail' && selectedItem
              ? {
                  onOpenFullPage: () => {
                    closeDrawer();
                    void navigate({
                      to: '/t/$tenant/_detail/$kind/$id',
                      params: {
                        tenant: tenantSlug,
                        kind: 'user',
                        id: selectedItem.user.id,
                      },
                    } as unknown as Parameters<typeof navigate>[0]);
                  },
                }
              : {})}
          />
        }
        position="right"
        size="min(520px, 95vw)"
        padding="md"
      >
        {drawerMode === 'detail' && selectedItem && (
          <UserDetail
            userId={selectedItem.user.id}
            currentTenantId={tenantId}
            tenantSlug={tenantSlug}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'invite' && (
          <UserInviteForm tenantId={tenantId} onSuccess={closeDrawer} onCancel={closeDrawer} />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/users')({
  beforeLoad: requirePermissions({ required: ['user:read'] }),
  component: UsersPage,
});
