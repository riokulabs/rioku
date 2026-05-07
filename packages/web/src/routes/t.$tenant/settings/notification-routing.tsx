/**
 * Notification routing rules — /t/$tenant/settings/notification-routing
 *
 * List + filter bar + drawer (detail / create / edit). Reorder uses up/down
 * arrow buttons on each row (no dnd dep).
 *
 * Permission guard: notification-routing:read.
 */
import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Anchor, Button, Drawer, Group, Stack, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowLeft, IconPlus } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  deleteRoutingRule,
  RoutingRuleDetail,
  RoutingRuleFilterBar,
  RoutingRuleForm,
  RoutingRuleList,
} from '@/features/notification-routing';
import type { NotificationRoutingRule, RoutingRuleFilter } from '@/features/notification-routing';

type DrawerMode = 'detail' | 'create' | 'edit';

interface SearchParams {
  search: string;
  enabled?: 'true' | 'false';
}

function NotificationRoutingPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantId = tenant;
  const tenantSlug = tenant;

  const canWrite = usePermission('notification-routing:write');

  const filter: RoutingRuleFilter = {
    search: search.search,
    enabled: search.enabled === 'true' ? true : search.enabled === 'false' ? false : undefined,
  };

  function setFilter(next: RoutingRuleFilter) {
    void navigate({
      to: '/t/$tenant/settings/notification-routing',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        enabled: next.enabled === true ? 'true' : next.enabled === false ? 'false' : '',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selected, setSelected] = useState<NotificationRoutingRule | null>(null);

  function handleRowClick(r: NotificationRoutingRule) {
    setSelected(r);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelected(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(r: NotificationRoutingRule) {
    setSelected(r);
    setDrawerMode('edit');
    openDrawer();
  }

  async function handleDeleteFromList(r: NotificationRoutingRule) {
    try {
      await deleteRoutingRule(r.id);
      notify.success('Rule deleted', `${r.name} was removed.`);
    } catch {
      notify.error('Failed to delete rule', 'Please try again.');
    }
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create routing rule'
      : drawerMode === 'edit'
        ? `Edit — ${selected?.name ?? ''}`
        : (selected?.name ?? 'Routing rule detail');

  return (
    <Stack gap="md" p="md" data-testid="notification-routing-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
          component={Link as any}
          to="/t/$tenant/settings/notifications"
          params={{ tenant: tenantSlug }}
          size="sm"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to notifications</span>
          </Group>
        </Anchor>
      </Group>

      <Group justify="space-between" align="center">
        <Title order={2}>Routing rules</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate} disabled={!canWrite}>
          New rule
        </Button>
      </Group>

      <RoutingRuleFilterBar filter={filter} onChange={setFilter} />

      <RoutingRuleList
        tenantId={tenantId}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onDelete={(r) => void handleDeleteFromList(r)}
      />

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
        {drawerMode === 'detail' && selected && (
          <RoutingRuleDetail
            ruleId={selected.id}
            onEdit={() => {
              setDrawerMode('edit');
            }}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <RoutingRuleForm
            mode="create"
            tenantId={tenantId}
            onSuccess={(r) => {
              setSelected(r);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selected && (
          <RoutingRuleForm
            mode="edit"
            tenantId={tenantId}
            initialValues={selected}
            onSuccess={(r) => {
              setSelected(r);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/notification-routing')({
  beforeLoad: requirePermissions({ required: ['notification-routing:read'] }),
  component: NotificationRoutingPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    ...(s.enabled === 'true'
      ? { enabled: 'true' as const }
      : s.enabled === 'false'
        ? { enabled: 'false' as const }
        : {}),
  }),
});
