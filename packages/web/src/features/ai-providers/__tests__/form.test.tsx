/**
 * Unit tests for <ProviderForm>.
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
import { ProviderForm } from '../components/form';

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

describe('ProviderForm', () => {
  it('renders all create-mode fields', () => {
    wrap(<ProviderForm mode="create" tenantId={acmeId()} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Base URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Credential/i)).toBeInTheDocument();
  });

  it('calls onCancel when Cancel clicked', () => {
    const onCancel = vi.fn();
    wrap(
      <ProviderForm mode="create" tenantId={acmeId()} onSuccess={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText(/Cancel/));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('submits a valid create form and invokes onSuccess', async () => {
    const onSuccess = vi.fn();
    wrap(
      <ProviderForm mode="create" tenantId={acmeId()} onSuccess={onSuccess} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Name/i), {
      target: { value: 'openai-test' },
    });
    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText(/Credential/i), {
      target: { value: 'sk-testkey' },
    });
    fireEvent.click(screen.getByText(/Create provider/));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
