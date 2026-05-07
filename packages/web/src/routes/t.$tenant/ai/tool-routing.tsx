/**
 * AI Tool Routing page — /t/$tenant/ai/tool-routing
 *
 * List ↔ Matrix view toggle. URL-synced agent + tool + enabled + condition
 * filter. Matrix cell click opens binding detail drawer (or create if no
 * binding exists yet).
 *
 * Permission guard: ai-tool:read (list / matrix).
 * Sensitive actions (create/update/delete) are gated inside components by
 * usePermission('ai-tool:write').
 */
import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer, SegmentedControl, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconLink } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { usePermission } from '@/hooks/use-permission';
import { notify } from '@/hooks/use-notify';
import {
  BindingList,
  BindingFilterBar,
  BindingForm,
  BindingDetail,
  BulkAttachModal,
  MatrixView,
} from '@/features/ai-tool-routing';
import type { BindingFilter } from '@/features/ai-tool-routing';
import type { AiToolBinding } from '@/api/resources';

type DrawerMode = 'detail' | 'create' | 'edit';
type ViewMode = 'list' | 'matrix';

interface SearchParams {
  view: ViewMode;
  agent_ids: string[];
  tool_ids: string[];
  enabled?: 'true' | 'false';
  has_condition?: 'true' | 'false';
  /** Deep-link: pre-select agent (single). */
  agent?: string;
  /** Deep-link: pre-select tool (single). */
  tool?: string;
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

function AiToolRoutingPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const canWrite = usePermission('ai-tool:write');

  // Stage-2 daemon-backed feature: tenantId is the URL slug; daemon resolves it.
  const tenantSlug = tenant;
  const tenantId = tenantSlug;

  /** Effective filter — merges multi-select csv with deep-link single ids. */
  const filter: BindingFilter = useMemo(() => {
    const agentIds = [...search.agent_ids];
    if (search.agent && !agentIds.includes(search.agent)) agentIds.push(search.agent);
    const toolIds = [...search.tool_ids];
    if (search.tool && !toolIds.includes(search.tool)) toolIds.push(search.tool);
    return {
      agent_ids: agentIds,
      tool_ids: toolIds,
      ...(search.enabled === 'true'
        ? { enabled: true }
        : search.enabled === 'false'
          ? { enabled: false }
          : {}),
      ...(search.has_condition === 'true'
        ? { has_condition: true }
        : search.has_condition === 'false'
          ? { has_condition: false }
          : {}),
    };
  }, [
    search.agent_ids,
    search.tool_ids,
    search.agent,
    search.tool,
    search.enabled,
    search.has_condition,
  ]);

  function setFilter(next: BindingFilter) {
    void navigate({
      to: '/t/$tenant/ai/tool-routing',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        agent_ids: next.agent_ids.join(','),
        tool_ids: next.tool_ids.join(','),
        enabled: next.enabled === true ? 'true' : next.enabled === false ? 'false' : '',
        has_condition:
          next.has_condition === true ? 'true' : next.has_condition === false ? 'false' : '',
        // Drop deep-link singles once user refines via filter bar.
        agent: '',
        tool: '',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  function setView(next: ViewMode) {
    void navigate({
      to: '/t/$tenant/ai/tool-routing',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({ ...prev, view: next }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [bulkOpened, { open: openBulk, close: closeBulk }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedBinding, setSelectedBinding] = useState<AiToolBinding | null>(null);
  const [createDefaults, setCreateDefaults] = useState<{
    agentId?: string;
    toolId?: string;
  }>({});

  function handleRowClick(b: AiToolBinding) {
    setSelectedBinding(b);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedBinding(null);
    setCreateDefaults({});
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(b: AiToolBinding) {
    setSelectedBinding(b);
    setDrawerMode('edit');
    openDrawer();
  }

  function handleEditFromDetail() {
    setDrawerMode('edit');
  }

  function handleDeleteFromList(b: AiToolBinding) {
    // Delete confirm lives inside the detail drawer.
    setSelectedBinding(b);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleMatrixCell({
    agent,
    tool,
    binding,
  }: {
    agent: { id: string };
    tool: { id: string };
    binding?: AiToolBinding;
  }) {
    if (binding) {
      setSelectedBinding(binding);
      setDrawerMode('detail');
    } else {
      setSelectedBinding(null);
      setCreateDefaults({ agentId: agent.id, toolId: tool.id });
      setDrawerMode('create');
    }
    openDrawer();
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create binding'
      : drawerMode === 'edit'
        ? 'Edit binding'
        : 'Binding detail';

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>AI Tool Routing</Title>
        <Group gap="sm">
          <SegmentedControl<ViewMode>
            data={[
              { value: 'list', label: 'List' },
              { value: 'matrix', label: 'Matrix' },
            ]}
            value={search.view}
            onChange={(v) => {
              setView(v);
            }}
            aria-label="View mode"
          />
          <Tooltip disabled={canWrite} label="You need ai-tool:write to bulk-attach">
            <Button
              variant="default"
              leftSection={<IconLink size={16} />}
              onClick={openBulk}
              disabled={!canWrite}
              aria-label="Bulk attach tools to agents"
            >
              Bulk attach
            </Button>
          </Tooltip>
          <Tooltip disabled={canWrite} label="You need ai-tool:write to create bindings">
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={handleCreate}
              disabled={!canWrite}
            >
              New binding
            </Button>
          </Tooltip>
        </Group>
      </Group>

      <BindingFilterBar tenantId={tenantId} filter={filter} onChange={setFilter} />

      {search.view === 'list' ? (
        <BindingList
          tenantId={tenantId}
          filter={filter}
          onSelect={handleRowClick}
          onEdit={handleEditFromList}
          onDelete={handleDeleteFromList}
        />
      ) : (
        <MatrixView tenantId={tenantId} filter={filter} onCellClick={handleMatrixCell} />
      )}

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
        {drawerMode === 'detail' && selectedBinding && (
          <BindingDetail
            tenantId={tenantId}
            bindingId={selectedBinding.id}
            onEdit={handleEditFromDetail}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <BindingForm
            mode="create"
            tenantId={tenantId}
            {...(createDefaults.agentId !== undefined
              ? { defaultAgentId: createDefaults.agentId }
              : {})}
            {...(createDefaults.toolId !== undefined
              ? { defaultToolId: createDefaults.toolId }
              : {})}
            onSuccess={(b) => {
              setSelectedBinding(b);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selectedBinding && (
          <BindingForm
            mode="edit"
            tenantId={tenantId}
            initialValues={selectedBinding}
            onSuccess={(b) => {
              setSelectedBinding(b);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>

      <BulkAttachModal
        tenantId={tenantId}
        opened={bulkOpened}
        onClose={closeBulk}
        onComplete={(s) => {
          notify.success(
            'Bulk attach complete',
            `${String(s.attached)} binding${s.attached === 1 ? '' : 's'} processed across ${String(s.agents)} agent${s.agents === 1 ? '' : 's'} and ${String(s.tools)} tool${s.tools === 1 ? '' : 's'}.`,
          );
        }}
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/tool-routing')({
  beforeLoad: requirePermissions({ required: ['ai-tool:read'] }),
  component: AiToolRoutingPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    view: s.view === 'matrix' ? 'matrix' : 'list',
    agent_ids: parseCsv(s.agent_ids),
    tool_ids: parseCsv(s.tool_ids),
    ...(s.enabled === 'true'
      ? { enabled: 'true' as const }
      : s.enabled === 'false'
        ? { enabled: 'false' as const }
        : {}),
    ...(s.has_condition === 'true'
      ? { has_condition: 'true' as const }
      : s.has_condition === 'false'
        ? { has_condition: 'false' as const }
        : {}),
    ...(typeof s.agent === 'string' && s.agent.length > 0 ? { agent: s.agent } : {}),
    ...(typeof s.tool === 'string' && s.tool.length > 0 ? { tool: s.tool } : {}),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
