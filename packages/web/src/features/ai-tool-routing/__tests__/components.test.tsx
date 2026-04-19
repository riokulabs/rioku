/**
 * Unit tests for ai-tool-routing components.
 *   - <BindingList>
 *   - <MatrixView>
 *   - <BindingForm>
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { BindingList } from '../components/list';
import { MatrixView } from '../components/matrix-view';
import { BindingForm } from '../components/form';
import type { BindingFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: BindingFilter = {
  agent_ids: [],
  tool_ids: [],
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

describe('BindingList', () => {
  it('renders seeded bindings for the acme tenant', () => {
    wrap(
      <BindingList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('shows empty state when filter yields no bindings', () => {
    wrap(
      <BindingList
        tenantId="nonexistent-tenant-id"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/No bindings/i).length).toBeGreaterThan(0);
  });
});

describe('MatrixView', () => {
  it('renders a grid of agents × tools', () => {
    wrap(
      <MatrixView
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onCellClick={vi.fn()}
      />,
    );
    expect(
      screen.getAllByLabelText(/Agent × tool binding matrix/i).length,
    ).toBeGreaterThan(0);
  });

  it('shows "need at least one agent and one tool" when tenant is empty', () => {
    wrap(
      <MatrixView
        tenantId="nonexistent-tenant-id"
        filter={DEFAULT_FILTER}
        onCellClick={vi.fn()}
      />,
    );
    expect(
      screen.getAllByText(/at least one agent and one tool/i).length,
    ).toBeGreaterThan(0);
  });
});

describe('BindingForm', () => {
  it('renders create-mode fields', () => {
    wrap(
      <BindingForm
        mode="create"
        tenantId={acmeId()}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText(/Agent/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Tool/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/CEL condition/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Create binding/i).length).toBeGreaterThan(0);
  });
});
