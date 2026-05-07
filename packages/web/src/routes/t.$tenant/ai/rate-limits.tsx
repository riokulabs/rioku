/**
 * AI Rate Limits page — /t/$tenant/ai/rate-limits
 *
 * List + filter bar + drawer (detail / create / edit). URL-synced search +
 * scope + action + enabled filter.
 *
 * Permission guard: ai-rate-limit:read.
 * Sensitive actions (create/update/delete) gated inside components by
 * usePermission('ai-rate-limit:write').
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { usePermission } from '@/hooks/use-permission';
import {
  RateLimitList,
  RateLimitFilterBar,
  RateLimitForm,
  RateLimitDetail,
} from '@/features/ai-rate-limits';
import type { RateLimitFilter } from '@/features/ai-rate-limits';
import type { AiSemanticRateLimit } from '@/api/resources';

type DrawerMode = 'detail' | 'create' | 'edit';
type Scope = AiSemanticRateLimit['scope'];
type Action = AiSemanticRateLimit['action'];

const SCOPE_VALUES: readonly Scope[] = ['tenant', 'agent', 'tool'];
const ACTION_VALUES: readonly Action[] = ['block', 'degrade', 'log'];

interface SearchParams {
  search: string;
  scopes: Scope[];
  actions: Action[];
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

function parseScopesCsv(v: unknown): Scope[] {
  return parseCsv(v).filter((s): s is Scope => (SCOPE_VALUES as readonly string[]).includes(s));
}

function parseActionsCsv(v: unknown): Action[] {
  return parseCsv(v).filter((s): s is Action => (ACTION_VALUES as readonly string[]).includes(s));
}

function AiRateLimitsPage() {
  const { tenant } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const canWrite = usePermission('ai-rate-limit:write');

  const tenantId = tenant ?? '';
  const tenantSlug = tenant ?? '';

  const filter: RateLimitFilter = {
    search: search.search,
    scopes: search.scopes,
    actions: search.actions,
    ...(search.enabled === 'true'
      ? { enabled: true }
      : search.enabled === 'false'
        ? { enabled: false }
        : {}),
  };

  function setFilter(next: RateLimitFilter) {
    void navigate({
      to: '/t/$tenant/ai/rate-limits',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        search: next.search,
        scopes: next.scopes.join(','),
        actions: next.actions.join(','),
        enabled: next.enabled === true ? 'true' : next.enabled === false ? 'false' : '',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('detail');
  const [selectedRule, setSelectedRule] = useState<AiSemanticRateLimit | null>(null);

  function handleRowClick(r: AiSemanticRateLimit) {
    setSelectedRule(r);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreate() {
    setSelectedRule(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleEditFromList(r: AiSemanticRateLimit) {
    setSelectedRule(r);
    setDrawerMode('edit');
    openDrawer();
  }

  function handleEditFromDetail() {
    setDrawerMode('edit');
  }

  function handleDeleteFromList(r: AiSemanticRateLimit) {
    setSelectedRule(r);
    setDrawerMode('detail');
    openDrawer();
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create rate limit'
      : drawerMode === 'edit'
        ? `Edit — ${selectedRule?.name ?? ''}`
        : (selectedRule?.name ?? 'Rate limit detail');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>AI Rate Limits</Title>
        <Tooltip disabled={canWrite} label="You need ai-rate-limit:write to create rules">
          <Button leftSection={<IconPlus size={16} />} onClick={handleCreate} disabled={!canWrite}>
            New rate limit
          </Button>
        </Tooltip>
      </Group>

      <RateLimitFilterBar filter={filter} onChange={setFilter} />

      <RateLimitList
        tenantId={tenantId}
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
        {drawerMode === 'detail' && selectedRule && (
          <RateLimitDetail
            tenantId={tenantId}
            ruleId={selectedRule.id}
            onEdit={handleEditFromDetail}
            onClose={closeDrawer}
          />
        )}
        {drawerMode === 'create' && (
          <RateLimitForm
            mode="create"
            tenantId={tenantId}
            onSuccess={(r) => {
              setSelectedRule(r);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'edit' && selectedRule && (
          <RateLimitForm
            mode="edit"
            tenantId={tenantId}
            initialValues={selectedRule}
            onSuccess={(r) => {
              setSelectedRule(r);
              setDrawerMode('detail');
            }}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/rate-limits')({
  beforeLoad: requirePermissions({ required: ['ai-rate-limit:read'] }),
  component: AiRateLimitsPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    search: typeof s.search === 'string' ? s.search : '',
    scopes: parseScopesCsv(s.scopes),
    actions: parseActionsCsv(s.actions),
    ...(s.enabled === 'true'
      ? { enabled: 'true' as const }
      : s.enabled === 'false'
        ? { enabled: 'false' as const }
        : {}),
    ...(typeof s.selected === 'string' ? { selected: s.selected } : {}),
  }),
});
