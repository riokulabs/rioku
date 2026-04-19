/**
 * Unit tests for <ModelManager>.
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
import { ModelManager } from '../components/model-manager';

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

function firstProviderId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  const p = Object.values(state.aiProviders).find(
    (pr) => pr.tenant_id === acme.id,
  );
  if (!p) throw new Error('No provider seeded');
  return p.id;
}

describe('ModelManager', () => {
  it('renders the models table for a seeded provider', () => {
    wrap(<ModelManager providerId={firstProviderId()} />);
    expect(screen.getAllByText(/Models/i).length).toBeGreaterThan(0);
  });

  it('toggles the add-model form via the Add model button', () => {
    wrap(<ModelManager providerId={firstProviderId()} />);
    const buttons = screen.getAllByText(/Add model/);
    // First match is the toggle button in the header.
    const first = buttons[0];
    if (!first) throw new Error('missing Add model button');
    fireEvent.click(first);
    expect(screen.getAllByText(/Upstream ID/).length).toBeGreaterThan(0);
  });
});
