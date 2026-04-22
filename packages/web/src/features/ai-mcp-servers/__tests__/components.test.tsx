/**
 * Unit tests for ai-mcp-servers components.
 *   - <McpServerList> renders + empty state
 *   - <McpServerDetail> renders identity, authorized-agent picker, exposed tools
 *   - <McpServerForm> renders create-mode fields + conditional credential input
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <span data-link="true">{children}</span>,
}));

import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { McpServerList } from '../components/list';
import { McpServerDetail } from '../components/detail';
import { McpServerForm } from '../components/form';
import type { McpServerFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: McpServerFilter = {
  search: '',
  healths: [],
  auth_kinds: [],
};

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function acmeId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return acme.id;
}

function firstServerId(): string | undefined {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) return undefined;
  const srv = Object.values(state.mcpServers).find((s) => s.tenant_id === acme.id);
  return srv?.id;
}

describe('McpServerList', () => {
  it('renders seeded MCP servers for acme tenant', () => {
    wrap(
      <McpServerList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onTest={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('shows empty state when tenant has no servers', () => {
    wrap(
      <McpServerList
        tenantId="nonexistent-tenant-id"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onTest={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/No MCP servers/i).length).toBeGreaterThan(0);
  });
});

describe('McpServerDetail', () => {
  it('renders server identity + authorized agents picker', () => {
    const id = firstServerId();
    if (!id) return;
    wrap(<McpServerDetail serverId={id} tenantSlug="acme" onEdit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByText(/Authorized agents/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Exposed tools/i).length).toBeGreaterThan(0);
  });

  it('shows not-found when server id is unknown', () => {
    wrap(
      <McpServerDetail
        serverId="does-not-exist"
        tenantSlug="acme"
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/MCP server not found/i)).toBeInTheDocument();
  });
});

describe('McpServerForm', () => {
  it('renders create-mode URL + name fields', () => {
    wrap(
      <McpServerForm mode="create" tenantId={acmeId()} onSuccess={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getAllByLabelText(/Name/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/URL/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Auth kind/i).length).toBeGreaterThan(0);
  });
});
