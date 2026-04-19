/**
 * Unit tests for <InvokePanel>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { InvokePanel } from '../components/invoke-panel';

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
  const a = Object.values(state.aiAgents).find(
    (ag) => ag.tenant_id === acme.id,
  );
  if (!a) throw new Error('No agent seeded');
  return a.id;
}

describe('InvokePanel', () => {
  it('renders prompt textarea and disabled Invoke button initially', () => {
    wrap(<InvokePanel agentId={firstAgentId()} />);
    expect(screen.getAllByLabelText('Prompt').length).toBeGreaterThan(0);
    const btn = screen.getByRole('button', { name: /Invoke/i });
    expect(btn).toBeDisabled();
  });

  it('enables and fires invoke after entering prompt', async () => {
    wrap(<InvokePanel agentId={firstAgentId()} />);
    const textarea = screen.getByLabelText('Prompt');
    fireEvent.change(textarea, { target: { value: 'Hello, agent!' } });
    const btn = screen.getByRole('button', { name: /Invoke/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => {
      // Result is rendered when a trace appears — status badge will show.
      const statusBadges = document.querySelectorAll('[class*="mantine-Badge"]');
      expect(statusBadges.length).toBeGreaterThan(0);
    });
  });
});
