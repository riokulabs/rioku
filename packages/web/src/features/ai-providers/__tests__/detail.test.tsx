/**
 * Unit tests for <ProviderDetail>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { ProviderDetail } from '../components/detail';
import { aiProviderHandlers, resetProviderStore, makeProvider } from './msw-handlers';

const SEED_PROVIDER = makeProvider({ id: 'prov-det-1', name: 'Detail Provider' });

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
  resetProviderStore([SEED_PROVIDER]);
  server.use(...aiProviderHandlers);
});

describe('ProviderDetail', () => {
  it('renders provider header + credential + models section', async () => {
    wrap(<ProviderDetail tenant="acme" providerId="prov-det-1" onEdit={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText(/Base URL/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Credential/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Models/i).length).toBeGreaterThan(0);
    });
  });

  it('shows error alert when provider not found', async () => {
    wrap(<ProviderDetail tenant="acme" providerId="does-not-exist" onEdit={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Provider not found/i)).toBeInTheDocument();
    });
  });
});
