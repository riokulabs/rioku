/**
 * AI MCP Servers page — /t/$tenant/ai/mcp-servers
 *
 * List + filter bar + drawer (detail / create / edit). URL-synced search +
 * health + auth + enabled filter. The drawer hosts the quick-info view; the
 * dedicated route at /t/$tenant/ai/mcp-servers/$serverId hosts the full
 * Tabs experience (Configuration / Test connectivity / Tools / Audit).
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { requirePermissions } from '@/hooks/use-before-load';
import { usePermission } from '@/hooks/use-permission';
import {
  McpServerList,
  McpServerFilterBar,
  McpServerForm,
  McpServerDrawer,
  testMcpServer,
} from '@/features/ai-mcp-servers';
import type { McpServerFilter } from '@/features/ai-mcp-servers';
import type { McpServer } from '@/api/resources';

type DrawerMode = 'detail' | 'create' | 'edit';
type Health = McpServer['health'];
type AuthKind = McpServer['auth_kind'];

const HEALTH_VALUES: readonly Health[] = ['healthy', 'degraded', 'unreachable', 'disabled'];
const AUTH_VALUES: readonly AuthKind[] = ['none', 'bearer', 'api-key'];

interface SearchParams {
  search: string;
  healths: Health[];
  auth_kinds: AuthKind[];
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

function parseHealthsCsv(v: unknown): Health[] {
  return parseCsv(v).filter((s): s is Health => (HEALTH_VALUES as readonly string[]).includes(s));
}

function parseAuthKindsCsv(v: unknown): AuthKind[] {
  return parseCsv(v).filter((s): s is AuthKind => (AUTH_VALUES as readonly string[]).includes(s));
}

function AiMcpServersPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const canWrite = usePermission('mcp-server:write');

  const filter: McpServerFilter = {
    search: search.search,
    healths: search.healths,
    auth_kinds: search.auth_kinds,
    ...(search.enabled === 'true'
      ? { enabled: true }
      : search.enabled === 'false'
        ? { enabled: false }
        : {}),
  };

  function setFilter(next: McpServerFilter) {
    void navigate({
      to: '/t/$tenant/ai/mcp-servers',
      params: { tenant },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        healths: next.healths.join(','),
        auth_kinds: next.auth_kinds.join(','),
        enabled: next.enabled === true ? 'true' : next.enabled === false ? 'false' : '',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);

  function handleRowClick(s: McpServer) {
    setSelectedServer(s);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedServer(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(s: McpServer) {
    setSelectedServer(s);
    setDrawerMode('edit');
    openDrawer();
  }

  function handleEditFromDetail() {
    setDrawerMode('edit');
  }

  async function handleTest(s: McpServer) {
    try {
      const result = await testMcpServer(tenant, s.id);
      if (result.ok) {
        notify.success(
          'Connection OK',
          `${s.name} responded in ${String(result.latency_ms)} ms${
            result.server_version ? ` (server: ${result.server_version})` : ''
          }.`,
        );
      } else {
        notify.error('Connection failed', result.error ?? 'Upstream error');
      }
    } catch {
      notify.error('Failed to test server', 'Please try again.');
    }
  }

  function handleDeleteFromList(s: McpServer) {
    setSelectedServer(s);
    setDrawerMode('detail');
    openDrawer();
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create MCP server'
      : drawerMode === 'edit'
        ? `Edit — ${selectedServer?.name ?? ''}`
        : (selectedServer?.name ?? 'MCP server detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>MCP Servers</Title>
        <Tooltip disabled={canWrite} label="You need mcp-server:write to create servers">
          <Button leftSection={<IconPlus size={16} />} onClick={handleCreate} disabled={!canWrite}>
            New MCP server
          </Button>
        </Tooltip>
      </Group>

      <McpServerFilterBar filter={filter} onChange={setFilter} />

      <McpServerList
        tenant={tenant}
        filter={filter}
        onSelect={handleRowClick}
        onEdit={handleEditFromList}
        onTest={(s) => void handleTest(s)}
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
        {drawerMode === 'detail' && selectedServer && (
          <McpServerDrawer
            serverId={selectedServer.id}
            tenant={tenant}
            onEdit={handleEditFromDetail}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <McpServerForm
            mode="create"
            tenant={tenant}
            onSuccess={(s) => {
              setSelectedServer(s);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selectedServer && (
          <McpServerForm
            mode="edit"
            tenant={tenant}
            initialValues={selectedServer}
            onSuccess={(s) => {
              setSelectedServer(s);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/mcp-servers')({
  beforeLoad: requirePermissions({ required: ['mcp-server:read'] }),
  component: AiMcpServersPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    healths: parseHealthsCsv(s.healths),
    auth_kinds: parseAuthKindsCsv(s.auth_kinds),
    ...(s.enabled === 'true'
      ? { enabled: 'true' as const }
      : s.enabled === 'false'
        ? { enabled: 'false' as const }
        : {}),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
