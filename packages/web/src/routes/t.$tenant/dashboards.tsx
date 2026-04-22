/**
 * Dashboards list page — /t/$tenant/dashboards
 *
 * List + filter bar. URL-synced search + modes + scopes + owners + defaultOnly.
 *
 * Permission guard: dashboard:read.
 */
import { useCallback, useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Modal, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconUpload } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import { usePermission } from '@/hooks/use-permission';
import {
  DashboardList,
  DashboardFilterBar,
  ImportDashboardModal,
  deleteDashboard,
  setDefaultDashboard,
  createDashboard,
} from '@/features/dashboards';
import type { DashboardFilter } from '@/features/dashboards';
import type { Dashboard } from '@/api/resources/types';

type Mode = Dashboard['mode'];
type Scope = Dashboard['scope'];

const MODE_VALUES: readonly Mode[] = ['metabase', 'grafana'];
const SCOPE_VALUES: readonly Scope[] = ['personal', 'tenant', 'shared'];

interface SearchParams {
  search: string;
  modes: Mode[];
  scopes: Scope[];
  owners: string[];
  defaultOnly?: 'true';
}

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

function parseModes(v: unknown): Mode[] {
  return parseCsv(v).filter((s): s is Mode => (MODE_VALUES as readonly string[]).includes(s));
}

function parseScopes(v: unknown): Scope[] {
  return parseCsv(v).filter((s): s is Scope => (SCOPE_VALUES as readonly string[]).includes(s));
}

function DashboardsListPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const canWrite = usePermission('dashboard:write');
  const canDelete = usePermission('dashboard:delete');
  const canSetDefault = usePermission('dashboard:set-default');

  const filter: DashboardFilter = useMemo(
    () => ({
      search: search.search,
      modes: search.modes,
      scopes: search.scopes,
      ...(search.defaultOnly === 'true' ? { defaultOnly: true } : {}),
    }),
    [search.search, search.modes, search.scopes, search.defaultOnly],
  );

  const ownerSet = useMemo(() => new Set(search.owners), [search.owners]);

  // Owner extra filter — '__shared__' matches owner_user_id === null.
  const extraFilter = useCallback(
    (d: Dashboard): boolean => {
      if (ownerSet.size === 0) return true;
      if (d.owner_user_id === null) return ownerSet.has('__shared__');
      return ownerSet.has(d.owner_user_id);
    },
    [ownerSet],
  );

  function writeSearch(next: {
    search?: string;
    modes?: Mode[];
    scopes?: Scope[];
    owners?: string[];
    /** Explicit undefined clears the flag. Omit to preserve current state. */
    defaultOnly?: 'true';
    /** Pass true to clear the defaultOnly flag. */
    clearDefaultOnly?: boolean;
  }) {
    void navigate({
      to: '/t/$tenant/dashboards',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => {
        const nextDefaultOnly = next.clearDefaultOnly
          ? ''
          : next.defaultOnly === 'true'
            ? 'true'
            : search.defaultOnly === 'true'
              ? 'true'
              : '';
        return {
          ...prev,
          search: next.search ?? search.search,
          modes: (next.modes ?? search.modes).join(','),
          scopes: (next.scopes ?? search.scopes).join(','),
          owners: (next.owners ?? search.owners).join(','),
          defaultOnly: nextDefaultOnly,
        };
      },
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const setFilter = useCallback(
    (next: DashboardFilter) => {
      writeSearch({
        search: next.search,
        modes: next.modes,
        scopes: next.scopes,
        ...(next.defaultOnly === true
          ? { defaultOnly: 'true' as const }
          : { clearDefaultOnly: true }),
      });
    },
    // writeSearch depends on stable search object via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search.search, search.modes, search.scopes, search.owners, search.defaultOnly],
  );

  const setOwners = useCallback(
    (owners: string[]) => {
      writeSearch({ owners });
    },
    // writeSearch depends on stable search object via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search.search, search.modes, search.scopes, search.owners, search.defaultOnly],
  );

  const [deleteTarget, setDeleteTarget] = useState<Dashboard | null>(null);
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false);

  function handleRowClick(d: Dashboard) {
    void navigate({
      to: '/t/$tenant/dashboards/$dashboardId',
      params: { tenant: tenantSlug, dashboardId: d.id },
    } as unknown as Parameters<typeof navigate>[0]);
  }

  function handleEdit(d: Dashboard) {
    void navigate({
      to: '/t/$tenant/dashboards/$dashboardId/edit',
      params: { tenant: tenantSlug, dashboardId: d.id },
    } as unknown as Parameters<typeof navigate>[0]);
  }

  async function handleClone(d: Dashboard) {
    try {
      const cloned = await createDashboard(tenantId, {
        name: `${d.name} (copy)`,
        ...(d.description !== undefined ? { description: d.description } : {}),
        mode: d.mode,
        scope: d.scope,
        owner_user_id: d.owner_user_id,
        shared_role_ids: [...d.shared_role_ids],
        variables: [...d.variables],
      });
      notify.success('Dashboard cloned', `Created ${cloned.name}.`);
    } catch (e) {
      notify.error('Clone failed', (e as Error).message);
    }
  }

  async function handleSetDefault(d: Dashboard) {
    try {
      await setDefaultDashboard(tenantId, d.id);
      notify.success('Default set', `${d.name} is now the tenant default.`);
    } catch (e) {
      notify.error('Failed to set default', (e as Error).message);
    }
  }

  function handleDelete(d: Dashboard) {
    setDeleteTarget(d);
    openDelete();
  }

  async function handleCreate() {
    try {
      const created = await createDashboard(tenantId, {
        name: 'Untitled dashboard',
        mode: 'metabase',
        scope: 'tenant',
        owner_user_id: null,
      });
      notify.success('Dashboard created', 'Starting builder…');
      void navigate({
        to: '/t/$tenant/dashboards/$dashboardId/edit',
        params: { tenant: tenantSlug, dashboardId: created.id },
      } as unknown as Parameters<typeof navigate>[0]);
    } catch (e) {
      notify.error('Create failed', (e as Error).message);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDashboard(deleteTarget.id);
      notify.success('Dashboard deleted', deleteTarget.name);
      closeDelete();
      setDeleteTarget(null);
    } catch (e) {
      notify.error('Delete failed', (e as Error).message);
    }
  }

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Dashboards</Title>
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconUpload size={16} />}
            disabled={!canWrite}
            onClick={openImport}
            data-testid="dashboards-import-open"
          >
            Import
          </Button>
          <Button
            leftSection={<IconPlus size={16} />}
            disabled={!canWrite}
            onClick={() => {
              void handleCreate();
            }}
          >
            New dashboard
          </Button>
        </Group>
      </Group>

      <DashboardFilterBar
        tenantId={tenantId}
        filter={filter}
        onChange={setFilter}
        owners={search.owners}
        onOwnersChange={setOwners}
      />

      <DashboardList
        tenantId={tenantId}
        filter={filter}
        extraFilter={extraFilter}
        onSelect={handleRowClick}
        onEdit={handleEdit}
        onClone={(d) => {
          void handleClone(d);
        }}
        onDelete={handleDelete}
        onSetDefault={(d) => {
          void handleSetDefault(d);
        }}
        canWrite={canWrite}
        canDelete={canDelete}
        canSetDefault={canSetDefault}
      />

      <ImportDashboardModal
        opened={importOpened}
        tenantId={tenantId}
        onClose={closeImport}
        onImported={(imported) => {
          void navigate({
            to: '/t/$tenant/dashboards/$dashboardId',
            params: { tenant: tenantSlug, dashboardId: imported.id },
          } as unknown as Parameters<typeof navigate>[0]);
        }}
      />

      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteTarget(null);
        }}
        title="Delete dashboard?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            This will permanently delete <strong>{deleteTarget?.name}</strong>, its widgets, and its
            version history. This action cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                closeDelete();
                setDeleteTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                void confirmDelete();
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/dashboards')({
  beforeLoad: requirePermissions({ required: ['dashboard:read'] }),
  component: DashboardsListPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    modes: parseModes(s.modes),
    scopes: parseScopes(s.scopes),
    owners: parseCsv(s.owners),
    ...(s.defaultOnly === 'true' ? { defaultOnly: 'true' as const } : {}),
  }),
});
