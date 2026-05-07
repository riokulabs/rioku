/**
 * Services page — /t/$tenant/services
 *
 * List + filter bar + drawer (detail / create / edit). URL-synced search +
 * env + health + tags + optional drawer-selected id.
 *
 * Per Plan 2 Task 2b.9 Step 2: env / health / tags are multi-value filters.
 * URL serialization uses comma-separated values (e.g. `?env=prod,staging`);
 * an empty / missing param resolves to `[]` ("no filter").
 *
 * Permission guard: service:read to view, service:write for Create/Edit,
 * service:delete for the delete confirm.
 */
import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import { DrawerTitleExpand } from '@/components/drawer-title-expand';
import {
  ServiceList,
  ServiceFilterBar,
  ServiceForm,
  ServiceDetail,
  forceReloadService,
  deleteService,
  ServiceInUseError,
  useServiceList,
} from '@/features/services';
import type { ServiceFilter } from '@/features/services';
import type { Service } from '@/api/resources';
import type { Route as RouteRecord } from '@/features/routes/types';

type DrawerMode = 'detail' | 'create' | 'edit';

type HealthStatus = ServiceFilter['health'][number];

interface SearchParams {
  search: string;
  env: string[];
  health: HealthStatus[];
  tags: string[];
  selected?: string;
}

const HEALTH_VALUES: readonly HealthStatus[] = ['healthy', 'degraded', 'unhealthy', 'disabled'];

function parseCsv(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof v !== 'string') return [];
  if (v.length === 0) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseHealthCsv(v: unknown): HealthStatus[] {
  return parseCsv(v).filter((s): s is HealthStatus =>
    (HEALTH_VALUES as readonly string[]).includes(s),
  );
}

function ServicesPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantId = tenant;
  const tenantSlug = tenant;

  // Stage-2: derive option lists from the daemon-backed service list.
  const allServices = useServiceList(tenantId, {
    search: '',
    env: [],
    health: [],
    tags: [],
  });
  const envOptions = useMemo(() => {
    const set = new Set<string>();
    for (const svc of allServices) set.add(svc.env);
    return Array.from(set).sort();
  }, [allServices]);
  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const svc of allServices) for (const t of svc.tags) set.add(t);
    return Array.from(set).sort();
  }, [allServices]);

  const filter: ServiceFilter = {
    search: search.search,
    env: search.env,
    health: search.health,
    tags: search.tags,
  };

  function setFilter(next: ServiceFilter) {
    void navigate({
      to: '/t/$tenant/services',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        env: next.env.join(','),
        health: next.health.join(','),
        tags: next.tags.join(','),
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedService, setSelectedService] = useState<Service | null>(null);

  function handleRowClick(svc: Service) {
    setSelectedService(svc);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedService(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(svc: Service) {
    setSelectedService(svc);
    setDrawerMode('edit');
    openDrawer();
  }

  function handleEditFromDetail() {
    setDrawerMode('edit');
  }

  async function handleForceReload(svc: Service) {
    try {
      await forceReloadService(tenantId, svc.id);
      notify.success('Service reloaded', `${svc.name} reloaded.`);
    } catch {
      notify.error('Failed to reload service', 'Please try again.');
    }
  }

  async function handleDeleteFromList(svc: Service) {
    try {
      await deleteService(tenantId, svc.id);
      notify.success('Service deleted', `${svc.name} was removed.`);
    } catch (err) {
      if (err instanceof ServiceInUseError) {
        notify.error(
          'Cannot delete — in use',
          `${String(err.routeIds.length)} route(s) still reference this service.`,
        );
      } else {
        notify.error('Failed to delete service', 'Please try again.');
      }
    }
  }

  const handleSelectRoute = (_r: RouteRecord) => {
    // Defer to per-route route-detail deep-link in task 2b.14.
  };
  const handleEditRoute = (_r: RouteRecord) => {
    // Same — deep-link to routes page.
  };
  const handleDeleteRoute = (_r: RouteRecord) => {
    // Same — deep-link to routes page.
  };
  void handleSelectRoute;
  void handleEditRoute;
  void handleDeleteRoute;

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create service'
      : drawerMode === 'edit'
        ? `Edit — ${selectedService?.name ?? ''}`
        : (selectedService?.name ?? 'Service detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Services</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          New service
        </Button>
      </Group>

      <ServiceFilterBar
        filter={filter}
        onChange={setFilter}
        envOptions={envOptions}
        tagOptions={tagOptions}
      />

      <ServiceList
        tenantId={tenantId}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onDelete={(svc) => void handleDeleteFromList(svc)}
        onForceReload={(svc) => void handleForceReload(svc)}
      />

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={
          <DrawerTitleExpand
            title={drawerTitle}
            {...(drawerMode === 'detail' && selectedService
              ? {
                  onOpenFullPage: () => {
                    closeDrawer();
                    void navigate({
                      to: '/t/$tenant/_detail/$kind/$id',
                      params: {
                        tenant: tenantSlug,
                        kind: 'service',
                        id: selectedService.id,
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
        {drawerMode === 'detail' && selectedService && (
          <ServiceDetail
            serviceId={selectedService.id}
            tenantId={tenantId}
            onEdit={handleEditFromDetail}
            onSelectRoute={handleSelectRoute}
            onEditRoute={handleEditRoute}
            onDeleteRoute={handleDeleteRoute}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <ServiceForm
            mode="create"
            tenantId={tenantId}
            onSuccess={(svc) => {
              setSelectedService(svc);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selectedService && (
          <ServiceForm
            mode="edit"
            tenantId={tenantId}
            initialValues={selectedService}
            onSuccess={(svc) => {
              setSelectedService(svc);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/services')({
  beforeLoad: requirePermissions({ required: ['service:read'] }),
  component: ServicesPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    env: parseCsv(s.env),
    health: parseHealthCsv(s.health),
    tags: parseCsv(s.tags),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
