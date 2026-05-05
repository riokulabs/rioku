/**
 * AI Providers page — /t/$tenant/ai/providers
 *
 * List + filter bar + drawer (detail / create / edit). URL-synced search +
 * kinds + enabled filter.
 *
 * Permission guard: ai-provider:read.
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  ProviderList,
  ProviderFilterBar,
  ProviderForm,
  ProviderDetail,
  testProvider,
} from '@/features/ai-providers';
import type { ProviderFilter } from '@/features/ai-providers';
import type { AiProvider } from '@/api/resources';

type DrawerMode = 'detail' | 'create' | 'edit';

type Kind = AiProvider['kind'];

const KIND_VALUES: readonly Kind[] = ['openai', 'anthropic', 'gemini', 'ollama', 'custom'];

interface SearchParams {
  search: string;
  kinds: Kind[];
  enabled?: 'true' | 'false';
  selected?: string;
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

function parseKindsCsv(v: unknown): Kind[] {
  return parseCsv(v).filter((s): s is Kind => (KIND_VALUES as readonly string[]).includes(s));
}

function AiProvidersPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const filter: ProviderFilter = {
    search: search.search,
    kinds: search.kinds,
    ...(search.enabled === 'true'
      ? { enabled: true }
      : search.enabled === 'false'
        ? { enabled: false }
        : {}),
  };

  function setFilter(next: ProviderFilter) {
    void navigate({
      to: '/t/$tenant/ai/providers',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        kinds: next.kinds.join(','),
        enabled: next.enabled === true ? 'true' : next.enabled === false ? 'false' : '',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(null);

  function handleRowClick(p: AiProvider) {
    setSelectedProvider(p);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedProvider(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(p: AiProvider) {
    setSelectedProvider(p);
    setDrawerMode('edit');
    openDrawer();
  }

  function handleEditFromDetail() {
    setDrawerMode('edit');
  }

  async function handleTest(p: AiProvider) {
    try {
      const result = await testProvider(p.id);
      if (result.ok) {
        notify.success('Connection OK', `${p.name} responded in ${String(result.latency_ms)}ms.`);
      } else {
        notify.error('Connection failed', result.error_message ?? 'Upstream error');
      }
    } catch {
      notify.error('Failed to test provider', 'Please try again.');
    }
  }

  function handleDeleteFromList(_p: AiProvider) {
    // Delete via drawer's typed-name confirm; here we just open detail.
    setSelectedProvider(_p);
    setDrawerMode('detail');
    openDrawer();
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create provider'
      : drawerMode === 'edit'
        ? `Edit — ${selectedProvider?.name ?? ''}`
        : (selectedProvider?.name ?? 'Provider detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>AI Providers</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          New provider
        </Button>
      </Group>

      <ProviderFilterBar filter={filter} onChange={setFilter} />

      <ProviderList
        tenantId={tenantId}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onDelete={handleDeleteFromList}
        onTest={(p) => void handleTest(p)}
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
        {drawerMode === 'detail' && selectedProvider && (
          <ProviderDetail
            providerId={selectedProvider.id}
            onEdit={handleEditFromDetail}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <ProviderForm
            mode="create"
            tenantId={tenantId}
            onSuccess={(p) => {
              setSelectedProvider(p);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selectedProvider && (
          <ProviderForm
            mode="edit"
            tenantId={tenantId}
            initialValues={selectedProvider}
            onSuccess={(p) => {
              setSelectedProvider(p);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/providers')({
  beforeLoad: requirePermissions({ required: ['ai-provider:read'] }),
  component: AiProvidersPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    kinds: parseKindsCsv(s.kinds),
    ...(s.enabled === 'true'
      ? { enabled: 'true' as const }
      : s.enabled === 'false'
        ? { enabled: 'false' as const }
        : {}),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
