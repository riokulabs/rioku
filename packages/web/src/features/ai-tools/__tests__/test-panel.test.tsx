/**
 * Unit tests for <TestPanel>.
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
import { TestPanel } from '../components/test-panel';

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

function firstToolId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  const t = Object.values(state.aiTools).find((tl) => tl.tenant_id === acme.id);
  if (!t) throw new Error('No tool seeded');
  return t.id;
}

describe('TestPanel', () => {
  it('renders sample input and Test button', () => {
    wrap(<TestPanel toolId={firstToolId()} />);
    expect(screen.getAllByLabelText('Sample input').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Test/i })).toBeInTheDocument();
  });

  it('shows a parse error for invalid JSON', async () => {
    wrap(<TestPanel toolId={firstToolId()} />);
    const textarea = screen.getByLabelText('Sample input');
    fireEvent.change(textarea, { target: { value: '{not-valid' } });
    fireEvent.click(screen.getByRole('button', { name: /Test/i }));
    await waitFor(() => {
      const alerts = document.querySelectorAll('[class*="mantine-Alert"]');
      expect(alerts.length).toBeGreaterThan(0);
    });
  });
});
