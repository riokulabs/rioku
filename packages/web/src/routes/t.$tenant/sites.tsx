/**
 * Sites page — /t/$tenant/sites
 *
 * List + filter bar + drawer (detail / create-wizard / edit). URL-synced
 * search + tls_mode + enabled + linked_service_ids filters.
 *
 * tls_mode / enabled / linked_service_ids are all multi-value filters.
 * URL serialization uses CSV
 * (e.g. `?tls_mode=auto,manual&enabled=enabled`).
 *
 * Permission guard: site:read to view, site:write for Create/Edit,
 * site:delete for the delete confirm inside <SiteDetail>.
 */
import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Drawer, Group, Stack, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  DeleteSiteModal,
  SiteCreateWizard,
  SiteDetail,
  SiteEditForm,
  SiteFilterBar,
  SiteList,
} from '@/features/sites';
import type { SiteEnabledFilter, SiteFilter } from '@/features/sites';
import type { Site } from '@/api/resources';
import { useServiceList } from '@/features/services';

type DrawerMode = 'detail' | 'create' | 'edit';

type TlsMode = Site['tls_mode'];

interface SearchParams {
  search: string;
  tls_mode: TlsMode[];
  enabled: SiteEnabledFilter[];
  linked_service_ids: string[];
  selected?: string;
}

const TLS_VALUES: readonly TlsMode[] = ['auto', 'manual', 'off'];
const ENABLED_VALUES: readonly SiteEnabledFilter[] = ['enabled', 'disabled'];

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

function parseTlsCsv(v: unknown): TlsMode[] {
  return parseCsv(v).filter((s): s is TlsMode => (TLS_VALUES as readonly string[]).includes(s));
}
function parseEnabledCsv(v: unknown): SiteEnabledFilter[] {
  return parseCsv(v).filter((s): s is SiteEnabledFilter =>
    (ENABLED_VALUES as readonly string[]).includes(s),
  );
}

function SitesPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantId = tenant;
  const tenantSlug = tenant;

  // Stage-2: derive service options from the daemon-backed service list.
  const allServices = useServiceList(tenantId, {
    search: '',
    env: [],
    health: [],
    tags: [],
  });
  const serviceOptions = useMemo(() => {
    return allServices
      .map((svc) => ({ value: svc.id, label: svc.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allServices]);

  const filter: SiteFilter = {
    search: search.search,
    tls_mode: search.tls_mode,
    enabled: search.enabled,
    linked_service_ids: search.linked_service_ids,
  };

  function setFilter(next: SiteFilter) {
    void navigate({
      to: '/t/$tenant/sites',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        tls_mode: next.tls_mode.join(','),
        enabled: next.enabled.join(','),
        linked_service_ids: next.linked_service_ids.join(','),
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Site | null>(null);

  function handleRowClick(site: Site) {
    setSelectedSite(site);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedSite(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(site: Site) {
    setSelectedSite(site);
    setDrawerMode('edit');
    openDrawer();
  }

  function handleDeleteFromList(site: Site) {
    setDeleteTarget(site);
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create site'
      : drawerMode === 'edit'
        ? `Edit — ${selectedSite?.domain ?? ''}`
        : (selectedSite?.domain ?? 'Site detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Sites</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          New site
        </Button>
      </Group>

      <SiteFilterBar filter={filter} onChange={setFilter} serviceOptions={serviceOptions} />

      <SiteList
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onDelete={handleDeleteFromList}
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
        {drawerMode === 'detail' && selectedSite && (
          <SiteDetail
            siteId={selectedSite.id}
            tenantSlug={tenantSlug}
            onEdit={() => {
              setDrawerMode('edit');
            }}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <SiteCreateWizard
            tenantId={tenantId}
            onSuccess={(site) => {
              setSelectedSite(site);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selectedSite && (
          <SiteEditForm
            initialValues={selectedSite}
            onSuccess={(site) => {
              setSelectedSite(site);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>

      <DeleteSiteModal
        opened={deleteTarget !== null}
        site={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
        }}
        onSuccess={() => {
          setDeleteTarget(null);
        }}
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/sites')({
  beforeLoad: requirePermissions({ required: ['site:read'] }),
  component: SitesPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    tls_mode: parseTlsCsv(s.tls_mode),
    enabled: parseEnabledCsv(s.enabled),
    linked_service_ids: parseCsv(s.linked_service_ids),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
