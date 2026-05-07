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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { ProviderForm } from '../components/form';
import { aiProviderHandlers, resetProviderStore } from './msw-handlers';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
  resetProviderStore();
  server.use(...aiProviderHandlers);
});

describe('ProviderForm', () => {
  it('renders all create-mode fields', () => {
    wrap(<ProviderForm mode="create" tenant="acme" onSuccess={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Base URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Credential/i)).toBeInTheDocument();
  });

  it('calls onCancel when Cancel clicked', () => {
    const onCancel = vi.fn();
    wrap(<ProviderForm mode="create" tenant="acme" onSuccess={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText(/Cancel/));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('submits a valid create form and invokes onSuccess', async () => {
    const onSuccess = vi.fn();
    wrap(<ProviderForm mode="create" tenant="acme" onSuccess={onSuccess} onCancel={vi.fn()} />);
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
