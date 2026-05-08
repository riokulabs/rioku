/**
 * Unit tests for <ModelManager>.
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
import { ModelManager } from '../components/model-manager';
import { aiProviderHandlers, resetProviderStore, makeProvider } from './msw-handlers';

const SEED_PROVIDER = makeProvider({
  id: 'prov-mm-1',
  name: 'ModelHost',
  models: [
    {
      upstream_id: 'gpt-4o',
      alias: 'gpt4o',
      rate_limit_rpm: 60,
      daily_quota_tokens: null,
      enabled: true,
    },
  ],
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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

describe('ModelManager', () => {
  it('renders the models table for a seeded provider', async () => {
    wrap(<ModelManager tenant="acme" providerId="prov-mm-1" />);
    await waitFor(() => {
      expect(screen.getAllByText(/Models/i).length).toBeGreaterThan(0);
    });
  });

  it('toggles the add-model form via the Add model button', async () => {
    wrap(<ModelManager tenant="acme" providerId="prov-mm-1" />);
    await waitFor(() => {
      const buttons = screen.getAllByText(/Add model/);
      const first = buttons[0];
      if (!first) throw new Error('missing Add model button');
      fireEvent.click(first);
    });
    await waitFor(() => {
      expect(screen.getAllByText(/Upstream ID/).length).toBeGreaterThan(0);
    });
  });
});
