/**
 * Unit tests for <AgentForm>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { AgentForm } from '../components/form';

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

function acmeId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return acme.id;
}

describe('AgentForm', () => {
  it('renders all create-mode fields', () => {
    wrap(<AgentForm mode="create" tenantId={acmeId()} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Provider/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/System prompt/i).length).toBeGreaterThan(0);
  });

  it('calls onCancel when Cancel clicked', () => {
    const onCancel = vi.fn();
    wrap(<AgentForm mode="create" tenantId={acmeId()} onSuccess={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText(/Cancel/));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
