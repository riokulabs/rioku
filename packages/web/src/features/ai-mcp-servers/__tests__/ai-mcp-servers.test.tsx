/**
 * Tests for the ai-mcp-servers feature CRUD surface + viewer permission
 * gating on the drawer's destructive actions.
 *
 * Backed by MSW: every mutation writes to the in-memory store in
 * `msw-handlers.ts`, which we then re-read after the call to confirm the
 * request reached the daemon-shaped endpoint.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span data-link="true">{children}</span>,
  useNavigate: () => vi.fn(),
}));

const permissionMock = vi.hoisted(() => ({ value: true as boolean }));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => permissionMock.value,
}));

import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import {
  createMcpServer,
  deleteMcpServer,
  updateMcpServer,
} from '../api';
import { McpServerDrawer } from '../components/drawer';
import {
  aiMcpServerHandlers,
  makeServer,
  resetMcpServerStore,
} from './msw-handlers';

const TENANT = 'acme';

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <MantineProvider defaultColorScheme="dark">
      <QueryClientProvider client={queryClient}>
        <Notifications />
        <ModalsProvider>{ui}</ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  resetMcpServerStore();
  permissionMock.value = true;
  server.use(...aiMcpServerHandlers);
});

describe('createMcpServer', () => {
  it('POSTs the daemon-shaped body and returns the adapted McpServer', async () => {
    const created = await createMcpServer(TENANT, {
      name: 'github-mcp',
      url: 'https://mcp.example.com',
      auth_kind: 'bearer',
      auth_credential: 'sk-test-secret',
    });
    expect(created.name).toBe('github-mcp');
    expect(created.tenant_id).toBe('tenant-acme');
    expect(created.auth_kind).toBe('bearer');
    expect(created.url).toBe('https://mcp.example.com');
    expect(created.health).toBe('healthy');
  });
});

describe('updateMcpServer', () => {
  it('PUTs partial input and returns the merged result', async () => {
    const seed = makeServer({ id: 'mcp-update-1', name: 'before' });
    resetMcpServerStore([seed]);
    server.use(...aiMcpServerHandlers);

    const after = await updateMcpServer(TENANT, 'mcp-update-1', {
      name: 'after',
      enabled: false,
    });
    expect(after.name).toBe('after');
    expect(after.enabled).toBe(false);
    expect(after.id).toBe('mcp-update-1');
  });

  it('serialises authorized_agent_ids into authorizedAgentIds for the daemon', async () => {
    const seed = makeServer({ id: 'mcp-update-2' });
    resetMcpServerStore([seed]);
    server.use(...aiMcpServerHandlers);

    const after = await updateMcpServer(TENANT, 'mcp-update-2', {
      authorized_agent_ids: ['agent-a', 'agent-b'],
    });
    expect(after.authorized_agent_ids).toEqual(['agent-a', 'agent-b']);
  });
});

describe('deleteMcpServer', () => {
  it('DELETEs and resolves on 204', async () => {
    const seed = makeServer({ id: 'mcp-del-1' });
    resetMcpServerStore([seed]);
    server.use(...aiMcpServerHandlers);

    await expect(deleteMcpServer(TENANT, 'mcp-del-1')).resolves.toBeUndefined();
  });
});

describe('McpServerDrawer — viewer permission gating', () => {
  it('disables Edit + Delete buttons when the user lacks mcp-server:write', async () => {
    const seed = makeServer({ id: 'mcp-view-1', name: 'restricted-mcp' });
    resetMcpServerStore([seed]);
    server.use(...aiMcpServerHandlers);
    permissionMock.value = false;

    wrap(
      <McpServerDrawer
        serverId="mcp-view-1"
        tenant={TENANT}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Wait for the detail to load.
    await waitFor(() => {
      expect(screen.getByText('restricted-mcp')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: /^Edit$/ });
    const deleteBtn = screen.getByRole('button', { name: /^Delete…$/ });
    expect(editBtn).toBeDisabled();
    expect(deleteBtn).toBeDisabled();
  });

  it('enables Edit + Delete when the user holds mcp-server:write', async () => {
    const seed = makeServer({ id: 'mcp-write-1', name: 'editable-mcp' });
    resetMcpServerStore([seed]);
    server.use(...aiMcpServerHandlers);
    permissionMock.value = true;

    wrap(
      <McpServerDrawer
        serverId="mcp-write-1"
        tenant={TENANT}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('editable-mcp')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /^Edit$/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Delete…$/ })).toBeEnabled();
  });

  it('opens the typed-name confirm modal on Delete and validates the name', async () => {
    const seed = makeServer({ id: 'mcp-del-2', name: 'must-type-this' });
    resetMcpServerStore([seed]);
    server.use(...aiMcpServerHandlers);
    permissionMock.value = true;

    wrap(
      <McpServerDrawer
        serverId="mcp-del-2"
        tenant={TENANT}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('must-type-this')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Delete…$/ }));

    await waitFor(() => {
      expect(screen.getByText('Delete MCP server')).toBeInTheDocument();
    });

    const confirmBtn = screen.getByRole('button', { name: /Delete permanently/i });
    expect(confirmBtn).toBeDisabled();
  });
});
