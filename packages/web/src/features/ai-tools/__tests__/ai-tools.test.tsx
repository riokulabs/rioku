/**
 * AI Tools — list / create / delete / viewer-gating tests.
 *
 * Exercises the daemon-backed slice end-to-end through MSW. Asserts:
 *   - ToolList renders rows from the daemon list endpoint
 *   - createTool POSTs and returns the freshly-created tool
 *   - deleteTool DELETEs and surfaces ToolInUseError on 409
 *   - the Invoke button on <TestInvocation> is disabled for viewers and
 *     enabled for ops/admin (i.e. ai-tool:invoke gating works).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...(rest as Record<string, unknown>)}>{children}</a>
  ),
}));

vi.mock('@monaco-editor/react', () => {
  const Editor = ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
  }) => (
    <textarea
      aria-label="Tool invocation input"
      data-testid="monaco-stub"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
  return { default: Editor };
});

import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { ToolList } from '../components/list';
import { TestInvocation } from '../components/test-invocation';
import { createTool, deleteTool } from '../api';
import { ToolInUseError } from '../types';
import type { ToolFilter } from '../types';
import { aiToolHandlers, makeTool, resetToolStore, setToolAgentRefs } from './msw-handlers';

const TENANT = 'acme';
const DEFAULT_FILTER: ToolFilter = { search: '', kinds: [] };

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetToolStore([
    makeTool({ id: 'aitool-1', name: 'web-search', kind: 'http', httpEndpoint: 'https://x' }),
    makeTool({ id: 'aitool-2', name: 'calc', kind: 'native' }),
    makeTool({ id: 'aitool-3', name: 'mcp-fetch', kind: 'mcp', mcpServerId: 'mcps-1' }),
  ]);
  server.use(...aiToolHandlers);
  // Reset + seed mock store for usePermission gating + tenant context.
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('ToolList', () => {
  it('renders rows fetched from the daemon', async () => {
    wrap(
      <ToolList
        tenant={TENANT}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('web-search')).toBeInTheDocument();
      expect(screen.getByText('calc')).toBeInTheDocument();
      expect(screen.getByText('mcp-fetch')).toBeInTheDocument();
    });
  });

  it('filters by kind', async () => {
    wrap(
      <ToolList
        tenant={TENANT}
        filter={{ search: '', kinds: ['native'] }}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('calc')).toBeInTheDocument();
      expect(screen.queryByText('web-search')).toBeNull();
    });
  });
});

describe('createTool', () => {
  it('POSTs to the daemon and returns the new tool', async () => {
    const t = await createTool(TENANT, {
      name: 'fresh',
      description: 'newly created',
      schema: { type: 'object', properties: {}, required: [] },
      kind: 'native',
      enabled: true,
      dangerous: false,
    });
    expect(t.id).toMatch(/^aitool-/);
    expect(t.name).toBe('fresh');
    expect(t.tenant_id).toBe(`tenant-${TENANT}`);
  });

  it('round-trips http_endpoint metadata', async () => {
    const t = await createTool(TENANT, {
      name: 'fetch-it',
      description: 'http tool',
      schema: {},
      kind: 'http',
      http_endpoint: { url: 'https://example/api', method: 'POST' },
    });
    expect(t.http_endpoint?.url).toBe('https://example/api');
    expect(t.http_endpoint?.method).toBe('POST');
  });
});

describe('deleteTool', () => {
  it('deletes successfully when no refs exist', async () => {
    await expect(deleteTool(TENANT, 'aitool-2')).resolves.toBeUndefined();
  });

  it('throws ToolInUseError on 409', async () => {
    setToolAgentRefs('aitool-1', ['agent-x']);
    await expect(deleteTool(TENANT, 'aitool-1')).rejects.toBeInstanceOf(ToolInUseError);
    try {
      await deleteTool(TENANT, 'aitool-1');
    } catch (err) {
      if (err instanceof ToolInUseError) {
        expect(err.agentIds).toContain('agent-x');
      } else {
        throw err;
      }
    }
  });
});

describe('viewer-gating on the Invoke button', () => {
  it('disables Invoke for viewers (no ai-tool:invoke permission)', async () => {
    // Switch the seeded current user to a viewer-only membership.
    const state = useMockStore.getState();
    const viewerMembership = Object.values(state.memberships).find((m) => {
      const role = state.roles[m.role_ids[0] ?? ''];
      return role?.name.toLowerCase() === 'viewer' && m.tenant_id === state.currentTenantId;
    });
    if (!viewerMembership) {
      throw new Error('seed has no viewer membership for the current tenant');
    }
    useMockStore.setState({ currentUserId: viewerMembership.user_id });

    wrap(<TestInvocation tenant={TENANT} toolId="aitool-1" />);
    const button = await screen.findByTestId('invoke-button');
    expect(button).toBeDisabled();
  });

  it('enables Invoke for the seeded admin user', async () => {
    // The default seeded user (Derrick) is admin/super-admin and has
    // ai-tool:invoke. Just render and assert.
    wrap(<TestInvocation tenant={TENANT} toolId="aitool-1" />);
    const button = await screen.findByTestId('invoke-button');
    expect(button).not.toBeDisabled();
  });
});
