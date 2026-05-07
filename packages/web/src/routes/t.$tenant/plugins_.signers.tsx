/**
 * /t/$tenant/plugins/signers — tenant-scoped signer allow-list (Plan 6).
 *
 * List + filter bar + drawer for tenant-scoped signers. Global signers are
 * managed separately from /admin/plugin-signers (super-admin only); this view
 * intentionally hides them so tenants can't accidentally revoke a global
 * trust anchor.
 *
 * Guard: plugin-signer:read.
 */
import { useState } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { Anchor, Breadcrumbs, Button, Drawer, Group, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconShieldCheck } from '@tabler/icons-react';
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

type Status = PluginSigner['status'];

const STATUS_VALUES: readonly Status[] = ['verified', 'pending', 'revoked'];

interface SearchParams {
  search: string;
  statuses: Status[];
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
  return parseCsv(v).filter((s): s is Status => (STATUS_VALUES as readonly string[]).includes(s));
}

function PluginSignersPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantId = tenant;
  const tenantSlug = tenant;

  const canWrite = usePermission('plugin-signer:write');

  const filter: SignerFilter = {
    search: search.search,
    statuses: search.statuses,
  };

  function setFilter(next: SignerFilter) {
    void navigate({
      to: '/t/$tenant/plugins/signers',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        statuses: next.statuses.join(','),
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
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
    // Delete flow lives in the drawer (typed-name confirm) — open detail.
    setSelected(s);
    setDrawerMode('detail');
    openDrawer();
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Add signer'
      : drawerMode === 'edit'
        ? `Edit — ${selected?.name ?? ''}`
        : (selected?.name ?? 'Signer detail');

  return (
    <Stack gap="md" p="md">
      <Breadcrumbs>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */}
        <Anchor component={Link as any} to="/t/$tenant/plugins" params={{ tenant: tenantSlug }}>
          Plugins
        </Anchor>
        <Text size="sm">Signer allow-list</Text>
      </Breadcrumbs>

      <Group justify="space-between" align="center">
        <Group gap="xs">
          <IconShieldCheck size={24} />
          <Title order={2}>Plugin signers</Title>
        </Group>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate} disabled={!canWrite}>
          Add signer
        </Button>
      </Group>

      <Text size="sm" c="var(--mantine-color-gray-7)">
        Tenant-scoped signer allow-list. Global signers managed by super-admin trust every tenant
        automatically and do not appear here.
      </Text>

      <SignerFilterBar filter={filter} onChange={setFilter} />

      <SignerList
        tenantScope={tenantId}
        filter={filter}
        onSelect={handleRowClick}
        onVerify={(s) => void handleVerify(s)}
        onRevoke={(s) => void handleRevoke(s)}
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
        {drawerMode === 'detail' && selected && (
          <SignerDetail
            tenantId={tenantId}
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
            tenantId={tenantId}
            allowGlobalScope={false}
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
            tenantId={tenantId}
            allowGlobalScope={false}
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

export const Route = createFileRoute('/t/$tenant/plugins_/signers')({
  beforeLoad: requirePermissions({ required: ['plugin-signer:read'] }),
  component: PluginSignersPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    statuses: parseStatuses(s.statuses),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
