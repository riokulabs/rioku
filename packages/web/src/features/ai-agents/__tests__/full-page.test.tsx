/**
 * Tests for <AgentFullPage> — verifies the four-tab structure (Profile,
 * Tools, Traces, Audit) renders against a daemon-backed agent fetch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { AgentFullPage } from '../components/full-page';
import { aiAgentHandlers, makeAgent, resetAgentStore } from './msw-handlers';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <Notifications />
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  resetAgentStore([
    makeAgent({
      id: 'aiagent-x',
      name: 'Full Page Agent',
      description: 'used for the full-page tab tests',
    }),
  ]);
  server.use(...aiAgentHandlers);
});

describe('<AgentFullPage>', () => {
  it('renders all four tab triggers', async () => {
    wrap(<AgentFullPage tenant="acme" agentId="aiagent-x" />);

    await waitFor(() => {
      expect(screen.getByText('Full Page Agent')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: /Profile/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Tools/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Traces/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Audit/i })).toBeInTheDocument();
  });

  it('switches to Tools tab and renders bound tools from the daemon', async () => {
    wrap(<AgentFullPage tenant="acme" agentId="aiagent-x" />);

    await waitFor(() => {
      expect(screen.getByText('Full Page Agent')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: /Tools/i }));

    await waitFor(() => {
      // tool-a / tool-b come from the MSW handler.
      expect(screen.getByText('tool-a')).toBeInTheDocument();
      expect(screen.getByText('tool-b')).toBeInTheDocument();
    });
  });

  it('switches to Traces tab and renders trace rows', async () => {
    wrap(<AgentFullPage tenant="acme" agentId="aiagent-x" />);

    await waitFor(() => {
      expect(screen.getByText('Full Page Agent')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: /Traces/i }));

    await waitFor(() => {
      // status badge "success" comes from the trace fixture.
      expect(screen.getAllByText(/success/i).length).toBeGreaterThan(0);
    });
  });

  it('switches to Audit tab without crashing', async () => {
    wrap(<AgentFullPage tenant="acme" agentId="aiagent-x" />);

    await waitFor(() => {
      expect(screen.getByText('Full Page Agent')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: /Audit/i }));

    await waitFor(() => {
      // Audit panel is reachable; tab content varies depending on seed.
      const tabPanel = screen.getByRole('tabpanel', { name: /Audit/i });
      expect(tabPanel).toBeInTheDocument();
    });
  });

  it('renders an error alert when the daemon returns 404', async () => {
    wrap(<AgentFullPage tenant="acme" agentId="does-not-exist" />);

    await waitFor(() => {
      expect(screen.getByText(/Agent not found/i)).toBeInTheDocument();
    });
  });
});
