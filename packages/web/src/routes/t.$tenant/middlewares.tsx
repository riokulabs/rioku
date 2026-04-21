/**
 * Middlewares page — /t/$tenant/middlewares
 *
 * List + filter bar + drawer for detail / create / edit. Guard: middleware:read.
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { notify } from '@/hooks/use-notify';
import {
  MiddlewareList,
  MiddlewareFilterBar,
  MiddlewareForm,
  MiddlewareDetail,
  deleteMiddleware,
  MiddlewareInUseError,
} from '@/features/middlewares';
import type { MiddlewareFilter } from '@/features/middlewares';
import type { Middleware } from '@/api/resources/types';
import { MIDDLEWARE_KINDS } from '@/features/middlewares';

type DrawerMode = 'detail' | 'create' | 'edit';

interface SearchParams {
  search: string;
  kind: MiddlewareFilter['kind'];
  enabled: MiddlewareFilter['enabled'];
}

function coerceKind(v: unknown): MiddlewareFilter['kind'] {
  if (typeof v !== 'string') return 'all';
  if (v === 'all') return 'all';
  if ((MIDDLEWARE_KINDS as readonly string[]).includes(v)) {
    return v as MiddlewareFilter['kind'];
  }
  return 'all';
}
function coerceEnabled(v: unknown): MiddlewareFilter['enabled'] {
  if (v === 'enabled' || v === 'disabled') return v;
  return 'all';
}

function MiddlewaresPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const filter: MiddlewareFilter = {
    search: search.search,
    kind: search.kind,
    enabled: search.enabled,
  };

  function setFilter(next: MiddlewareFilter) {
    void navigate({
      to: '/t/$tenant/middlewares',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        kind: next.kind,
        enabled: next.enabled,
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selected, setSelected] = useState<Middleware | null>(null);

  function handleRowClick(m: Middleware) {
    setSelected(m);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelected(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(m: Middleware) {
    setSelected(m);
    setDrawerMode('edit');
    openDrawer();
  }

  async function handleDeleteFromList(m: Middleware) {
    try {
      await deleteMiddleware(m.id);
      notify.success('Middleware deleted', `${m.name} was removed.`);
    } catch (err) {
      if (err instanceof MiddlewareInUseError) {
        notify.error(
          'Cannot delete — in use',
          `${String(err.routeIds.length)} route(s) still reference this middleware.`,
        );
      } else {
        notify.error('Failed to delete middleware', 'Please try again.');
      }
    }
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create middleware'
      : drawerMode === 'edit'
        ? `Edit — ${selected?.name ?? ''}`
        : selected?.name ?? 'Middleware detail';

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Middlewares</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          New middleware
        </Button>
      </Group>

      <MiddlewareFilterBar filter={filter} onChange={setFilter} />

      <MiddlewareList
        tenantId={tenantId}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onDelete={(m) => void handleDeleteFromList(m)}
      />

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="min(520px, 95vw)"
        padding="md"
      >
        {drawerMode === 'detail' && selected && (
          <MiddlewareDetail
            middlewareId={selected.id}
            onEdit={() => {
              setDrawerMode('edit');
            }}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <MiddlewareForm
            mode="create"
            tenantId={tenantId}
            onSuccess={(m) => {
              setSelected(m);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selected && (
          <MiddlewareForm
            mode="edit"
            tenantId={tenantId}
            initialValues={selected}
            onSuccess={(m) => {
              setSelected(m);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/middlewares')({
  beforeLoad: requirePermissions({ required: ['middleware:read'] }),
  component: MiddlewaresPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    kind: coerceKind(s.kind),
    enabled: coerceEnabled(s.enabled),
  }),
});
