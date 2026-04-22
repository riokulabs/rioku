/**
 * AI Tools page — /t/$tenant/ai/tools
 *
 * List + filter bar + drawer (detail / create / edit). URL-synced search +
 * kinds + dangerous + enabled filter.
 *
 * Permission guard: ai-tool:read.
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Alert, Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconInfoCircle, IconPlus } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  ToolList,
  ToolFilterBar,
  ToolForm,
  ToolDetail,
  deleteTool,
  ToolInUseError,
} from '@/features/ai-tools';
import type { ToolFilter } from '@/features/ai-tools';
import type { AiTool } from '@/api/resources/types';

type DrawerMode = 'detail' | 'create' | 'edit';

type Kind = AiTool['kind'];

const KIND_VALUES: readonly Kind[] = ['native', 'mcp', 'http'];

interface SearchParams {
  search: string;
  kinds: Kind[];
  enabled?: 'true' | 'false';
  dangerous?: 'true' | 'false';
  /** Deep-link: filter to tools exposed by this MCP server id. */
  mcp_server_id?: string;
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

function AiToolsPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const filter: ToolFilter = {
    search: search.search,
    kinds: search.kinds,
    ...(search.enabled === 'true'
      ? { enabled: true }
      : search.enabled === 'false'
        ? { enabled: false }
        : {}),
    ...(search.dangerous === 'true'
      ? { dangerous: true }
      : search.dangerous === 'false'
        ? { dangerous: false }
        : {}),
    ...(search.mcp_server_id !== undefined ? { mcp_server_id: search.mcp_server_id } : {}),
  };

  function setFilter(next: ToolFilter) {
    void navigate({
      to: '/t/$tenant/ai/tools',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        kinds: next.kinds.join(','),
        enabled: next.enabled === true ? 'true' : next.enabled === false ? 'false' : '',
        dangerous: next.dangerous === true ? 'true' : next.dangerous === false ? 'false' : '',
        mcp_server_id: next.mcp_server_id ?? '',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedTool, setSelectedTool] = useState<AiTool | null>(null);

  function handleRowClick(t: AiTool) {
    setSelectedTool(t);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedTool(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(t: AiTool) {
    setSelectedTool(t);
    setDrawerMode('edit');
    openDrawer();
  }

  function handleEditFromDetail() {
    setDrawerMode('edit');
  }

  async function handleDeleteFromList(t: AiTool) {
    try {
      await deleteTool(t.id);
      notify.success('Tool deleted', `${t.name} was removed.`);
    } catch (err) {
      if (err instanceof ToolInUseError) {
        notify.error(
          'Cannot delete — in use',
          `${String(err.agentIds.length)} agent(s) and ${String(err.bindingIds.length)} binding(s) reference this tool.`,
        );
      } else {
        notify.error('Failed to delete tool', 'Please try again.');
      }
    }
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create tool'
      : drawerMode === 'edit'
        ? `Edit — ${selectedTool?.name ?? ''}`
        : (selectedTool?.name ?? 'Tool detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>AI Tools</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          New tool
        </Button>
      </Group>

      <ToolFilterBar filter={filter} onChange={setFilter} />

      {filter.mcp_server_id !== undefined && (
        <Alert
          variant="light"
          color="blue"
          icon={<IconInfoCircle size={16} />}
          withCloseButton
          onClose={() => {
            const next: ToolFilter = { ...filter };
            delete next.mcp_server_id;
            setFilter(next);
          }}
        >
          Showing tools exposed by MCP server{' '}
          <strong>{tenantId && filter.mcp_server_id ? filter.mcp_server_id : ''}</strong>. Close
          this banner to clear the filter.
        </Alert>
      )}

      <ToolList
        tenantId={tenantId}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onDelete={(t) => void handleDeleteFromList(t)}
      />

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="min(520px, 95vw)"
        padding="md"
      >
        {drawerMode === 'detail' && selectedTool && (
          <ToolDetail
            toolId={selectedTool.id}
            tenantSlug={tenantSlug}
            onEdit={handleEditFromDetail}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <ToolForm
            mode="create"
            tenantId={tenantId}
            onSuccess={(t) => {
              setSelectedTool(t);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selectedTool && (
          <ToolForm
            mode="edit"
            tenantId={tenantId}
            initialValues={selectedTool}
            onSuccess={(t) => {
              setSelectedTool(t);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/tools')({
  beforeLoad: requirePermissions({ required: ['ai-tool:read'] }),
  component: AiToolsPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    kinds: parseKindsCsv(s.kinds),
    ...(s.enabled === 'true'
      ? { enabled: 'true' as const }
      : s.enabled === 'false'
        ? { enabled: 'false' as const }
        : {}),
    ...(s.dangerous === 'true'
      ? { dangerous: 'true' as const }
      : s.dangerous === 'false'
        ? { dangerous: 'false' as const }
        : {}),
    ...(typeof s.mcp_server_id === 'string' && s.mcp_server_id.length > 0
      ? { mcp_server_id: s.mcp_server_id }
      : {}),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
