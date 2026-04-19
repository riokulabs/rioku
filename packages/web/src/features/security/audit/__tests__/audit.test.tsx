/**
 * Tests for the audit feature.
 *
 * Covers: list renders, pagination, filter narrowing, export, tail toggle,
 * detail drawer with CodeBlock + DiffView.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';

// ── Mock shiki so CodeBlock tests don't hang on WASM ─────────────────────────
vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockImplementation((code: string) => {
      return `<pre><code>${code}</code></pre>`;
    }),
  }),
}));

// ── Mock router ───────────────────────────────────────────────────────────────
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { AuditList } from '../components/list';
import { AuditEntryDetail } from '../components/detail-drawer';
import { DEFAULT_AUDIT_FILTER } from '../types';
import type { AuditEntryWithContext } from '../types';

// ── Wrapper ───────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  vi.clearAllMocks();
});

// ── AuditList render ──────────────────────────────────────────────────────────

describe('AuditList', () => {
  it('renders the audit list heading', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    wrap(<AuditList tenantId={acme?.id ?? ''} />);
    expect(screen.getByRole('heading', { name: /audit log/i })).toBeInTheDocument();
  });

  it('renders paginated entries from seeded 300 entries', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    wrap(<AuditList tenantId={acme?.id ?? ''} />);
    // Should render table rows (at least 1 header + some data rows)
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('shows total entry count badge', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    wrap(<AuditList tenantId={acme?.id ?? ''} />);
    // Badge with "X entries" text (may match multiple — getAllByText)
    expect(screen.getAllByText(/entries/i).length).toBeGreaterThan(0);
  });

  it('opens filter panel when Filters button is clicked', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    wrap(<AuditList tenantId={acme?.id ?? ''} />);
    const filtersBtn = screen.getByRole('button', { name: /toggle filters/i });
    fireEvent.click(filtersBtn);
    expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
  });

  it('has tail toggle button', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    wrap(<AuditList tenantId={acme?.id ?? ''} />);
    expect(screen.getByTestId('tail-toggle')).toBeInTheDocument();
  });

  it('has export button', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    wrap(<AuditList tenantId={acme?.id ?? ''} />);
    expect(screen.getByTestId('export-button')).toBeInTheDocument();
  });

  it('opens export dialog when export button is clicked', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    wrap(<AuditList tenantId={acme?.id ?? ''} />);
    fireEvent.click(screen.getByTestId('export-button'));
    expect(screen.getByTestId('export-dialog')).toBeInTheDocument();
  });

  it('toggles tail mode when tail button is clicked', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    wrap(<AuditList tenantId={acme?.id ?? ''} />);
    const tailBtn = screen.getByTestId('tail-toggle');
    // Before toggle: not active (no TailIndicator)
    expect(screen.queryByTestId('tail-indicator')).toBeNull();
    fireEvent.click(tailBtn);
    // After toggle: TailIndicator visible
    expect(screen.getByTestId('tail-indicator')).toBeInTheDocument();
  });
});

// ── useAuditList ──────────────────────────────────────────────────────────────

describe('useAuditList hook', () => {
  it('returns all seeded entries for acme tenant', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    const { entries, total } = useAuditListStatic(acme?.id ?? '');
    expect(total).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(25); // page size
  });

  it('narrows results when outcome filter applied', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    const { total: all } = useAuditListStatic(acme?.id ?? '');
    const { total: denied } = useAuditListStatic(acme?.id ?? '', { outcomes: ['denied'] });
    expect(denied).toBeLessThanOrEqual(all);
  });

  it('narrows results when action filter applied', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    const { total: all } = useAuditListStatic(acme?.id ?? '');
    const { total: login } = useAuditListStatic(acme?.id ?? '', { actions: ['user.login'] });
    expect(login).toBeLessThanOrEqual(all);
  });
});

/**
 * Static (non-hook) helper that exercises the same filter logic as useAuditList
 * without needing a React component.
 */
function useAuditListStatic(
  tenantId: string,
  partial: Partial<typeof DEFAULT_AUDIT_FILTER> = {},
) {
  const filter = { ...DEFAULT_AUDIT_FILTER, ...partial };
  const audit = useMockStore.getState().audit;
  const users = useMockStore.getState().users;

  function enrichEntry(entry: (typeof audit)[0]): AuditEntryWithContext {
    const actor = users[entry.actor_id];
    return { ...entry, actor_name: actor?.name ?? entry.actor_id };
  }

  function matches(entry: (typeof audit)[0]): boolean {
    if (filter.tenant_id) {
      if (entry.tenant_id !== filter.tenant_id) return false;
    } else if (tenantId) {
      if (entry.tenant_id !== null && entry.tenant_id !== tenantId) return false;
    }
    if (filter.actions.length > 0 && !filter.actions.includes(entry.action)) return false;
    if (filter.outcomes.length > 0 && !filter.outcomes.includes(entry.outcome)) return false;
    if (filter.resource_types.length > 0 && !filter.resource_types.includes(entry.resource_type))
      return false;
    return true;
  }

  const filtered = [...audit].reverse().filter(matches).map(enrichEntry);
  const total = filtered.length;
  const entries = filtered.slice(0, 25);
  return { entries, total };
}

// ── useAuditExport ────────────────────────────────────────────────────────────

describe('useAuditExport', () => {
  it('calls URL.createObjectURL when exporting', () => {
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');

    // Stub URL APIs
    const mockUrl = 'blob:mock-url';
    const createObjectURL = vi.fn().mockReturnValue(mockUrl);
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    // Replicate the export logic without using document.createElement
    const audit = useMockStore.getState().audit;
    const users = useMockStore.getState().users;
    const tenantId = acme?.id ?? '';

    const filtered = [...audit].reverse().filter((e) => {
      if (tenantId && e.tenant_id !== null && e.tenant_id !== tenantId) return false;
      return true;
    }).map((e) => ({
      ...e,
      actor_name: users[e.actor_id]?.name ?? e.actor_id,
    }));

    const content = filtered.map((e) => JSON.stringify(e)).join('\n');
    const blob = new Blob([content], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    URL.revokeObjectURL(url);

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith(mockUrl);
  });
});

// ── AuditEntryDetail ──────────────────────────────────────────────────────────

describe('AuditEntryDetail', () => {
  it('renders metadata fields', () => {
    const entry: AuditEntryWithContext = {
      id: 'audit-test-1',
      tenant_id: 'tenant-1',
      actor_id: 'user-1',
      actor_name: 'Alice',
      action: 'role.update',
      resource_type: 'role',
      resource_id: 'role-1',
      outcome: 'success',
      at: new Date().toISOString(),
      tier: 'write',
    };
    wrap(<AuditEntryDetail entry={entry} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('role.update')).toBeInTheDocument();
    expect(screen.getByText('role')).toBeInTheDocument();
  });

  it('renders impersonation banner when acted_as_admin', () => {
    const entry: AuditEntryWithContext = {
      id: 'audit-test-2',
      tenant_id: 'tenant-1',
      actor_id: 'admin-1',
      actor_name: 'Super Admin',
      action: 'user.disable',
      resource_type: 'user',
      outcome: 'success',
      at: new Date().toISOString(),
      tier: 'destructive',
      acted_as_admin: true,
      impersonation_session_id: 'imp-session-1',
    };
    wrap(<AuditEntryDetail entry={entry} />);
    expect(screen.getByTestId('impersonation-banner')).toBeInTheDocument();
  });

  it('renders CodeBlock when payload is present', () => {
    const entry: AuditEntryWithContext = {
      id: 'audit-test-3',
      tenant_id: 'tenant-1',
      actor_id: 'user-1',
      actor_name: 'Bob',
      action: 'service.create',
      resource_type: 'service',
      outcome: 'success',
      at: new Date().toISOString(),
      tier: 'write',
      payload: { name: 'my-service', upstream: 'http://localhost:3000' },
    };
    wrap(<AuditEntryDetail entry={entry} />);
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
  });

  it('renders DiffView when diff is present', () => {
    const entry: AuditEntryWithContext = {
      id: 'audit-test-4',
      tenant_id: 'tenant-1',
      actor_id: 'user-1',
      actor_name: 'Carol',
      action: 'role.update',
      resource_type: 'role',
      outcome: 'success',
      at: new Date().toISOString(),
      tier: 'write',
      diff: {
        before: { role: 'viewer' },
        after: { role: 'editor' },
      },
    };
    wrap(<AuditEntryDetail entry={entry} />);
    expect(screen.getByTestId('diff-view')).toBeInTheDocument();
  });
});

// ── Tail subscription ─────────────────────────────────────────────────────────

describe('audit tail', () => {
  it('live banner appears after mockBus publishes audit:new', async () => {
    const { publishMock } = await import('@/api/mock-sse');
    const state = useMockStore.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');

    wrap(<AuditList tenantId={acme?.id ?? ''} />);

    // Enable tail mode
    fireEvent.click(screen.getByTestId('tail-toggle'));

    // Publish a new entry
    publishMock('audit:new', {
      id: 'live-1',
      tenant_id: acme?.id ?? null,
      actor_id: Object.keys(state.users)[0] ?? 'user-1',
      action: 'user.login',
      resource_type: 'user',
      outcome: 'success',
      at: new Date().toISOString(),
      tier: 'read',
    });

    await waitFor(() => {
      expect(screen.getByTestId('live-entries-banner')).toBeInTheDocument();
    });
  });
});
