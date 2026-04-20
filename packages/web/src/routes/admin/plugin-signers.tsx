/**
 * /admin/plugin-signers — super-admin signer allow-list (Plan 6).
 *
 * Shows ALL signers across tenants (global + per-tenant) in a single flat
 * list. Only super-admins with admin:cross-tenant-read hit this route. Global
 * scope signers (tenant_scope === null) are the primary use case; per-tenant
 * signers are included here so ops can audit them from one place.
 *
 * Tenant-scoped users manage their own signers at
 * `/t/$tenant/plugins/signers`.
 */
import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Drawer,
  Group,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconShieldCheck, IconWorld, IconBuilding } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { usePermission } from '@/hooks/use-permission';
import { notify } from '@/hooks/use-notify';
import {
  SignerDetail,
  SignerFilterBar,
  SignerForm,
  SignerList,
  revokeSigner,
  verifySigner,
} from '@/features/plugin-signers';
import type { PluginSigner, SignerFilter } from '@/features/plugin-signers';

type DrawerMode = 'detail' | 'create' | 'edit';
/** Active tab — either the sentinel 'global' OR a tenant id string. The
 *  union collapses to `string` at runtime; keeping a named alias documents
 *  the intent even if it's structurally equivalent to string. */
type ScopeTab = string;

type Status = PluginSigner['status'];
const STATUS_VALUES: readonly Status[] = ['verified', 'pending', 'revoked'];

interface SearchParams {
  search: string;
  statuses: Status[];
  scope?: string;
  selected?: string;
}

function parseCsv(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof v !== 'string' || v.length === 0) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseStatuses(v: unknown): Status[] {
  return parseCsv(v).filter((s): s is Status =>
    (STATUS_VALUES as readonly string[]).includes(s),
  );
}

function AdminPluginSignersPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  const canWrite = usePermission('plugin-signer:write');

  // Collect the distinct tenant_scopes that appear among signers so super-admin
  // gets one tab per tenant that actually has signers (+ a Global tab first).
  const signerScopes = useMockStore((s) => s.pluginSigners);
  const tenants = useMockStore((s) => s.tenants);

  const tenantScopeIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of Object.values(signerScopes)) {
      if (s.tenant_scope !== null) set.add(s.tenant_scope);
    }
    return [...set].sort();
  }, [signerScopes]);

  const activeScope: ScopeTab =
    search.scope === undefined || search.scope === '' ? 'global' : search.scope;

  function handleTabChange(next: string | null) {
    if (next === null) return;
    void navigate({
      to: '/admin/plugin-signers',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        scope: next === 'global' ? undefined : next,
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const filter: SignerFilter = {
    search: search.search,
    statuses: search.statuses,
  };

  function setFilter(next: SignerFilter) {
    void navigate({
      to: '/admin/plugin-signers',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        statuses: next.statuses.join(','),
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selected, setSelected] = useState<PluginSigner | null>(null);

  function handleRowClick(s: PluginSigner) {
    setSelected(s);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelected(null);
    setDrawerMode('create');
    openDrawer();
  }

  async function handleVerify(s: PluginSigner) {
    try {
      await verifySigner(s.id);
      notify.success('Signer verified', `${s.name} is now trusted.`);
    } catch {
      notify.error('Failed to verify signer', 'Please try again.');
    }
  }

  async function handleRevoke(s: PluginSigner) {
    try {
      await revokeSigner(s.id);
      notify.info('Signer revoked', `${s.name} is no longer trusted.`);
    } catch {
      notify.error('Failed to revoke signer', 'Please try again.');
    }
  }

  function handleDeleteFromList(s: PluginSigner) {
    setSelected(s);
    setDrawerMode('detail');
    openDrawer();
  }

  const tenantScope = activeScope === 'global' ? null : activeScope;

  const drawerTitle =
    drawerMode === 'create'
      ? 'Add signer'
      : drawerMode === 'edit'
        ? `Edit — ${selected?.name ?? ''}`
        : selected?.name ?? 'Signer detail';

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <IconShieldCheck size={24} />
          <Title order={2}>Plugin signers</Title>
          <Badge color="orange" variant="light" size="sm">
            super-admin
          </Badge>
        </Group>
        {activeScope === 'global' && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={handleCreate}
            disabled={!canWrite}
          >
            Add global signer
          </Button>
        )}
      </Group>

      <Text size="sm" c="var(--mantine-color-gray-7)">
        Global signers are trusted by every tenant. Per-tenant tabs give
        visibility into signers managed by individual tenants — manage those
        from within the tenant workspace.
      </Text>

      <Tabs value={activeScope} onChange={handleTabChange} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="global" leftSection={<IconWorld size={14} />}>
            Global
          </Tabs.Tab>
          {tenantScopeIds.map((tid) => {
            const t = tenants[tid];
            return (
              <Tabs.Tab
                key={tid}
                value={tid}
                leftSection={<IconBuilding size={14} />}
              >
                {t?.name ?? tid}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>

        {/*
          Each tab owns a matching <Tabs.Panel> so Mantine's aria-controls
          wiring lines up with a real panel. All panels render the same
          SignerFilterBar + SignerList; the `tenantScope` prop drives the
          filter so each tab surfaces the right rows. keepMounted={false}
          on the parent <Tabs> means only the active panel mounts, so the
          SignerList only renders once per tab activation.
        */}
        <Tabs.Panel value="global" pt="md">
          <Stack gap="md">
            <SignerFilterBar filter={filter} onChange={setFilter} />
            <SignerList
              tenantScope={tenantScope}
              filter={filter}
              onSelect={handleRowClick}
              onVerify={(s) => void handleVerify(s)}
              onRevoke={(s) => void handleRevoke(s)}
              onDelete={handleDeleteFromList}
            />
          </Stack>
        </Tabs.Panel>
        {tenantScopeIds.map((tid) => (
          <Tabs.Panel key={tid} value={tid} pt="md">
            <Stack gap="md">
              <SignerFilterBar filter={filter} onChange={setFilter} />
              <SignerList
                tenantScope={tenantScope}
                filter={filter}
                onSelect={handleRowClick}
                onVerify={(s) => void handleVerify(s)}
                onRevoke={(s) => void handleRevoke(s)}
                onDelete={handleDeleteFromList}
              />
            </Stack>
          </Tabs.Panel>
        ))}
      </Tabs>

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="xl"
        padding="md"
      >
        {drawerMode === 'detail' && selected && (
          <SignerDetail
            signerId={selected.id}
            onClose={closeDrawer}
            onEdit={() => {
              setDrawerMode('edit');
            }}
          />
        )}
        {drawerMode === 'create' && (
          <SignerForm
            mode="create"
            tenantId={null}
            allowGlobalScope
            onSuccess={(s) => {
              setSelected(s);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selected && (
          <SignerForm
            mode="edit"
            tenantId={selected.tenant_scope}
            allowGlobalScope
            initialValues={selected}
            onSuccess={(s) => {
              setSelected(s);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/admin/plugin-signers')({
  beforeLoad: requirePermissions({
    required: ['admin:cross-tenant-read', 'plugin-signer:read'],
    requireAny: false,
  }),
  component: AdminPluginSignersPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    statuses: parseStatuses(s.statuses),
    ...(typeof s.scope === 'string' ? { scope: s.scope } : {}),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
