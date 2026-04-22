/**
 * Unit tests for <ServiceForm>.
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
import { ServiceForm } from '../components/form';

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

function nameInput(): HTMLInputElement {
  return screen.getByPlaceholderText('auth-api');
}

function upstreamInput(): HTMLInputElement {
  return screen.getByPlaceholderText('http://upstream:8080');
}

describe('ServiceForm (create)', () => {
  it('renders name, upstream, and a Create button', () => {
    wrap(<ServiceForm mode="create" tenantId={acmeId()} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    expect(nameInput()).toBeInTheDocument();
    expect(upstreamInput()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create service/i })).toBeInTheDocument();
  });

  it('shows validation error on empty name submit', async () => {
    wrap(<ServiceForm mode="create" tenantId={acmeId()} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create service/i }));
    await waitFor(() => {
      const errors = screen.queryAllByText(/required|name|least|small/i);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  it('submits successfully and calls onSuccess', async () => {
    const onSuccess = vi.fn();
    wrap(
      <ServiceForm mode="create" tenantId={acmeId()} onSuccess={onSuccess} onCancel={vi.fn()} />,
    );
    fireEvent.change(nameInput(), { target: { value: 'test-service' } });
    fireEvent.change(upstreamInput(), {
      target: { value: 'http://test:8080' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create service/i }));
    await waitFor(
      () => {
        expect(onSuccess).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});

describe('ServiceForm (edit)', () => {
  it('pre-fills fields from initialValues', () => {
    const svc = Object.values(useMockStore.getState().services).find(
      (s) => s.tenant_id === acmeId(),
    );
    if (!svc) throw new Error('no seeded service');

    wrap(
      <ServiceForm
        mode="edit"
        tenantId={acmeId()}
        initialValues={svc}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(nameInput().value).toBe(svc.name);
    expect(upstreamInput().value).toBe(svc.upstream);
  });
});
