/**
 * Unit tests for <AgentDetail>.
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
import { AgentDetail } from '../components/detail';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function firstAgentId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  const a = Object.values(state.aiAgents).find((ag) => ag.tenant_id === acme.id);
  if (!a) throw new Error('No agent seeded');
  return a.id;
}

describe('AgentDetail', () => {
  it('renders agent header, tools, guardrails, and invoke panel sections', () => {
    wrap(
      <AgentDetail agentId={firstAgentId()} tenantSlug="acme" onEdit={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getAllByText(/Tools/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Guardrails/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Invoke/i).length).toBeGreaterThan(0);
  });

  it('shows error alert when agent not found', () => {
    wrap(
      <AgentDetail agentId="does-not-exist" tenantSlug="acme" onEdit={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/Agent not found/i)).toBeInTheDocument();
  });
});
