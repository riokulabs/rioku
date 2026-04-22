/**
 * Unit tests for <MiddlewareList>, <MiddlewareForm>, <MiddlewareDetail>.
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
import { MiddlewareList } from '../components/list';
import { MiddlewareForm } from '../components/form';
import { MiddlewareDetail } from '../components/detail';
import type { MiddlewareFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: MiddlewareFilter = {
  search: '',
  kind: 'all',
  enabled: 'all',
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

describe('MiddlewareList', () => {
  it('renders seeded middlewares', () => {
    wrap(
      <MiddlewareList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const rows = screen.queryAllByRole('row');
    // Seeded middlewares (tenant-scoped), plus header.
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('fires onSelect on row click', () => {
    const onSelect = vi.fn();
    wrap(
      <MiddlewareList
        tenantId={acmeId()}
        filter={DEFAULT_FILTER}
        onSelect={onSelect}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const dataRows = screen.getAllByRole('row').slice(1);
    const firstRow = dataRows[0];
    if (!firstRow) throw new Error('No data rows');
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('MiddlewareForm', () => {
  it('creates a middleware with valid rate-limit config', async () => {
    const onSuccess = vi.fn();
    wrap(
      <MiddlewareForm mode="create" tenantId={acmeId()} onSuccess={onSuccess} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/global-rate-limit/i), {
      target: { value: 'test-rl' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create middleware/i }));
    await waitFor(
      () => {
        expect(onSuccess).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});

describe('MiddlewareDetail', () => {
  it('renders middleware header + referencing routes section', () => {
    const state = useMockStore.getState();
    const mw = Object.values(state.middlewares).find((m) => m.tenant_id === acmeId());
    if (!mw) throw new Error('no middleware');

    wrap(<MiddlewareDetail middlewareId={mw.id} onEdit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByText(mw.name).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/referenced by/i).length).toBeGreaterThan(0);
  });
});
