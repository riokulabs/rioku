/**
 * AI Agents page — /t/$tenant/ai/agents
 *
 * List + filter bar + drawer. URL-synced search + provider + role + enabled
 * filter. Drawer is a quick summary; "Open full page" navigates to
 * /t/$tenant/ai/agents/$agentId.
 *
 * Permission guard: ai-agent:read.
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  AgentList,
  AgentFilterBar,
  AgentForm,
  AgentDrawer,
  deleteAgent,
} from '@/features/ai-agents';
import type { AgentFilter } from '@/features/ai-agents';
import type { AiAgent } from '@/api/resources';

type DrawerMode = 'detail' | 'create' | 'edit';

interface SearchParams {
  search: string;
  provider_ids: string[];
  role_ids: string[];
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

function AiAgentsPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  // Tenant slug is the URL segment; the mock-store id is needed to filter
  // provider/role/tool option lists in the form (those features are still on
  // mock-store as of stage-2 plan-04 ai-agents slice).
  // Stage-2: tenantId is the URL slug; daemon resolves it.
  const tenantId = tenant ?? '';

  const filter: AgentFilter = {
    search: search.search,
    provider_ids: search.provider_ids,
    role_ids: search.role_ids,
    ...(search.enabled === 'true'
      ? { enabled: true }
      : search.enabled === 'false'
        ? { enabled: false }
        : {}),
  };

  function setFilter(next: AgentFilter) {
    void navigate({
      to: '/t/$tenant/ai/agents',
      params: { tenant },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        provider_ids: next.provider_ids.join(','),
        role_ids: next.role_ids.join(','),
        enabled: next.enabled === true ? 'true' : next.enabled === false ? 'false' : '',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedAgent, setSelectedAgent] = useState<AiAgent | null>(null);

  function handleRowClick(a: AiAgent) {
    setSelectedAgent(a);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedAgent(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(a: AiAgent) {
    setSelectedAgent(a);
    setDrawerMode('edit');
    openDrawer();
  }

  function handleEditFromDetail() {
    setDrawerMode('edit');
  }

  function handleInvokeFromList(a: AiAgent) {
    void navigate({
      to: '/t/$tenant/ai/agents/$agentId',
      params: { tenant, agentId: a.id },
    } as unknown as Parameters<typeof navigate>[0]);
  }

  async function handleDeleteFromList(a: AiAgent) {
    try {
      await deleteAgent(tenant, a.id);
      notify.success('Agent deleted', `${a.name} was removed.`);
    } catch {
      notify.error('Failed to delete agent', 'Please try again.');
    }
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create agent'
      : drawerMode === 'edit'
        ? `Edit — ${selectedAgent?.name ?? ''}`
        : (selectedAgent?.name ?? 'Agent detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>AI Agents</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          New agent
        </Button>
      </Group>

      <AgentFilterBar tenantId={tenantId} filter={filter} onChange={setFilter} />

      <AgentList
        tenant={tenant}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onDelete={(a) => void handleDeleteFromList(a)}
        onInvoke={handleInvokeFromList}
      />

      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="min(520px, 95vw)"
        padding="md"
      >
        {drawerMode === 'detail' && selectedAgent && (
          <AgentDrawer
            tenant={tenant}
            agentId={selectedAgent.id}
            onEdit={handleEditFromDetail}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <AgentForm
            mode="create"
            tenant={tenant}
            tenantId={tenantId}
            onSuccess={(a) => {
              setSelectedAgent(a);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selectedAgent && (
          <AgentForm
            mode="edit"
            tenant={tenant}
            tenantId={tenantId}
            initialValues={selectedAgent}
            onSuccess={(a) => {
              setSelectedAgent(a);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/agents')({
  beforeLoad: requirePermissions({ required: ['ai-agent:read'] }),
  component: AiAgentsPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    provider_ids: parseCsv(s.provider_ids),
    role_ids: parseCsv(s.role_ids),
    ...(s.enabled === 'true'
      ? { enabled: 'true' as const }
      : s.enabled === 'false'
        ? { enabled: 'false' as const }
        : {}),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
