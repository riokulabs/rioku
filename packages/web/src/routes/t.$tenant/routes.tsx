/**
 * Routes page — /t/$tenant/routes
 *
 * Tenant-wide route list (not scoped to a single service). Drawer-based
 * detail + edit + create.
 */
import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer, TextInput, Select } from '@mantine/core';
import { useDisclosure, useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import { DrawerTitleExpand } from '@/components/drawer-title-expand';
import { RouteList, RouteForm, RouteDetail, deleteRoute } from '@/features/routes';
import type { RouteFilter } from '@/features/routes';
import type { Route as RouteRecord } from '@/api/resources';
import { useServiceList } from '@/features/services';

type DrawerMode = 'detail' | 'create' | 'edit';

interface SearchParams {
  search: string;
  method: RouteFilter['method'];
  enabled: RouteFilter['enabled'];
}

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'] as const;

function coerceMethod(v: unknown): RouteFilter['method'] {
  if (typeof v !== 'string') return 'all';
  if (v === 'all') return 'all';
  if ((VALID_METHODS as readonly string[]).includes(v)) {
    return v as RouteFilter['method'];
  }
  return 'all';
}
function coerceEnabled(v: unknown): RouteFilter['enabled'] {
  if (v === 'enabled' || v === 'disabled') return v;
  return 'all';
}

function RoutesPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantId = tenant ?? '';
  const tenantSlug = tenant ?? '';

  const filter: RouteFilter = useMemo(
    () => ({
      search: search.search,
      method: search.method,
      enabled: search.enabled,
    }),
    [search.search, search.method, search.enabled],
  );

  const [searchInput, setSearchInput] = useState(filter.search);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  // Service filter — null = "All services"
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);

  // Fetch services for the service filter dropdown
  const services = useServiceList(tenantId, { search: '', health: [], env: [], tags: [] });
  const serviceOptions = useMemo(
    () => [
      { value: '', label: 'All services' },
      ...services.map((s) => ({ value: s.id, label: s.name })),
    ],
    [services],
  );

  function commit(next: RouteFilter) {
    void navigate({
      to: '/t/$tenant/routes',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        method: next.method,
        enabled: next.enabled,
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  // Commit debounced search
  if (debouncedSearch !== filter.search) {
    commit({ ...filter, search: debouncedSearch });
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selected, setSelected] = useState<RouteRecord | null>(null);

  function handleRowClick(r: RouteRecord) {
    setSelected(r);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelected(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(r: RouteRecord) {
    setSelected(r);
    setDrawerMode('edit');
    openDrawer();
  }

  async function handleDeleteFromList(r: RouteRecord) {
    try {
      await deleteRoute(tenantId, r.id);
      notify.success('Route deleted', `${r.name} was removed.`);
    } catch {
      notify.error('Failed to delete route', 'Please try again.');
    }
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create route'
      : drawerMode === 'edit'
        ? `Edit — ${selected?.name ?? ''}`
        : (selected?.name ?? 'Route detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Routes</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          New route
        </Button>
      </Group>

      <Group gap="sm" align="flex-end">
        <TextInput
          placeholder="Search by name or path…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.currentTarget.value);
          }}
          style={{ flex: 1 }}
          aria-label="Search routes"
        />
        <Select
          data={serviceOptions}
          value={serviceFilter ?? ''}
          onChange={(v) => {
            setServiceFilter(v !== '' ? v : null);
          }}
          w={200}
          aria-label="Filter by service"
          data-testid="routes-service-filter"
        />
        <Select
          data={[
            { value: 'all', label: 'All methods' },
            ...VALID_METHODS.map((m) => ({ value: m, label: m })),
          ]}
          value={filter.method}
          onChange={(v) => {
            commit({ ...filter, method: coerceMethod(v) });
          }}
          w={160}
          aria-label="Filter by method"
        />
        <Select
          data={[
            { value: 'all', label: 'All' },
            { value: 'enabled', label: 'Enabled' },
            { value: 'disabled', label: 'Disabled' },
          ]}
          value={filter.enabled}
          onChange={(v) => {
            commit({ ...filter, enabled: coerceEnabled(v) });
          }}
          w={140}
          aria-label="Filter by enabled"
        />
      </Group>

      <RouteList
        tenantId={tenantId}
        {...(serviceFilter !== null ? { serviceId: serviceFilter } : {})}
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
        title={
          <DrawerTitleExpand
            title={drawerTitle}
            {...(drawerMode === 'detail' && selected
              ? {
                  onOpenFullPage: () => {
                    closeDrawer();
                    void navigate({
                      to: '/t/$tenant/_detail/$kind/$id',
                      params: { tenant: tenantSlug, kind: 'route', id: selected.id },
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
        {drawerMode === 'detail' && selected && (
          <RouteDetail
            routeId={selected.id}
            tenantId={tenantId}
            onEdit={() => {
              setDrawerMode('edit');
            }}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <RouteForm
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
          <RouteForm
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

export const Route = createFileRoute('/t/$tenant/routes')({
  beforeLoad: requirePermissions({ required: ['route:read'] }),
  component: RoutesPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    method: coerceMethod(s.method),
    enabled: coerceEnabled(s.enabled),
  }),
});
