/**
 * Tests for <ToolsTab>.
 *
 * Renders the tools list returned by `GET /ai/mcp-servers/{id}/tools`,
 * each row showing name + description + schema preview.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span data-link="true">{children}</span>,
  useNavigate: () => vi.fn(),
}));

import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { ToolsTab } from '../components/tools-tab';
import { aiMcpServerHandlers, makeServer, resetMcpServerStore, seedTools } from './msw-handlers';

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
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  resetMcpServerStore([makeServer({ id: 'mcp-tools' })]);
  server.use(...aiMcpServerHandlers);
});

describe('<ToolsTab>', () => {
  it('renders an empty-state message when the server exposes no tools', async () => {
    wrap(<ToolsTab tenant={TENANT} serverId="mcp-tools" />);

    await waitFor(() => {
      expect(
        screen.getByText(/has not exposed any tools yet/i),
      ).toBeInTheDocument();
    });
  });

  it('renders a row per tool with name + description + schema preview', async () => {
    seedTools([
      {
        id: 'tool-search',
        name: 'web_search',
        description: 'Search the public web for information.',
        argSchema: JSON.stringify({
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'integer' } },
        }),
        mcpServerId: 'mcp-tools',
      },
      {
        id: 'tool-cmd',
        name: 'run_command',
        description: 'Run a shell command in the sandbox.',
        argSchema: JSON.stringify({
          type: 'object',
          properties: { cmd: { type: 'string' } },
        }),
        dangerous: true,
        mcpServerId: 'mcp-tools',
      },
    ]);
    server.use(...aiMcpServerHandlers);

    wrap(<ToolsTab tenant={TENANT} serverId="mcp-tools" />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-tools-table')).toBeInTheDocument();
    });
    expect(screen.getByText('web_search')).toBeInTheDocument();
    expect(screen.getByText(/Search the public web/i)).toBeInTheDocument();
    expect(screen.getByText('run_command')).toBeInTheDocument();

    // Argument schema preview should mention each tool's top-level keys.
    expect(screen.getByTestId('mcp-tool-args-preview-tool-search')).toHaveTextContent('query');
    expect(screen.getByTestId('mcp-tool-args-preview-tool-cmd')).toHaveTextContent('cmd');

    // "dangerous" badge is rendered for run_command.
    expect(screen.getByText('dangerous')).toBeInTheDocument();
  });

  it('expands the schema panel when a row is clicked', async () => {
    seedTools([
      {
        id: 'tool-1',
        name: 'echo',
        description: 'Echo input back.',
        argSchema: JSON.stringify({ type: 'object', properties: { msg: { type: 'string' } } }),
        mcpServerId: 'mcp-tools',
      },
    ]);
    server.use(...aiMcpServerHandlers);

    wrap(<ToolsTab tenant={TENANT} serverId="mcp-tools" />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-tool-row-tool-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mcp-tool-row-tool-1'));

    await waitFor(() => {
      expect(screen.getByTestId('mcp-tool-schema-tool-1')).toBeInTheDocument();
    });
  });
});
