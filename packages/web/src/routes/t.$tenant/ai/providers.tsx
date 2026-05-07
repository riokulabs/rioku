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
import { requirePermissions } from '@/hooks/use-before-load';
import {
  ProviderList,
  ProviderFilterBar,
  ProviderForm,
  ProviderDetail,
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
      params: { tenant },
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
        tenant={tenant}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onDelete={handleDeleteFromList}
        onTest={handleRowClick}
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
            tenant={tenant}
            providerId={selectedProvider.id}
            onEdit={handleEditFromDetail}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <ProviderForm
            mode="create"
            tenant={tenant}
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
            tenant={tenant}
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
