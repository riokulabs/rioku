/**
 * Tests for the <TestConnectivityPanel> component.
 *
 *   - ok=true scenario: renders an OK badge, latency, server version
 *   - ok=false scenario: renders a FAIL badge, latency, error message
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span data-link="true">{children}</span>,
  useNavigate: () => vi.fn(),
}));

import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { TestConnectivityPanel } from '../components/test-connectivity-panel';
import {
  aiMcpServerHandlers,
  makeServer,
  resetMcpServerStore,
  setTestResult,
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
        {ui}
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  resetMcpServerStore([makeServer({ id: 'mcp-conn' })]);
  server.use(...aiMcpServerHandlers);
});

describe('<TestConnectivityPanel>', () => {
  it('renders OK + latency + server version on a successful probe', async () => {
    setTestResult({ ok: true, latencyMs: 87, serverVersion: 'mcp/0.2.1' });
    server.use(...aiMcpServerHandlers);

    wrap(<TestConnectivityPanel tenant={TENANT} serverId="mcp-conn" />);

    fireEvent.click(screen.getByTestId('mcp-test-connection-button'));

    await waitFor(() => {
      expect(screen.getByTestId('mcp-test-status-badge')).toHaveTextContent('OK');
    });
    expect(screen.getByTestId('mcp-test-latency')).toHaveTextContent('87 ms');
    expect(screen.getByTestId('mcp-test-server-version')).toHaveTextContent('mcp/0.2.1');
    // Error block must NOT render in the ok=true case.
    expect(screen.queryByTestId('mcp-test-error')).not.toBeInTheDocument();
  });

  it('renders FAIL + latency + error on a failing probe', async () => {
    setTestResult({ ok: false, latencyMs: 5023, error: 'connection refused' });
    server.use(...aiMcpServerHandlers);

    wrap(<TestConnectivityPanel tenant={TENANT} serverId="mcp-conn" />);

    fireEvent.click(screen.getByTestId('mcp-test-connection-button'));

    await waitFor(() => {
      expect(screen.getByTestId('mcp-test-status-badge')).toHaveTextContent('FAIL');
    });
    expect(screen.getByTestId('mcp-test-latency')).toHaveTextContent('5023 ms');
    expect(screen.getByTestId('mcp-test-error')).toHaveTextContent('connection refused');
  });

  it('appends successive probes to a recent-history list', async () => {
    setTestResult({ ok: true, latencyMs: 12 });
    server.use(...aiMcpServerHandlers);

    wrap(<TestConnectivityPanel tenant={TENANT} serverId="mcp-conn" />);
    const button = screen.getByTestId('mcp-test-connection-button');

    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-test-status-badge')).toBeInTheDocument();
    });

    setTestResult({ ok: false, latencyMs: 34, error: 'upstream returned status 500' });
    server.use(...aiMcpServerHandlers);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-test-status-badge')).toHaveTextContent('FAIL');
    });
    // Previous OK probe is now in the history list.
    await waitFor(() => {
      expect(screen.getAllByTestId('mcp-test-history-row').length).toBeGreaterThanOrEqual(1);
    });
  });
});
