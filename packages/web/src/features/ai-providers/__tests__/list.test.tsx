/**
 * Unit tests for <ProviderList> + <ProviderFilterBar>.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/msw-server';
import { ProviderList } from '../components/list';
import type { ProviderFilter } from '../types';
import { aiProviderHandlers, resetProviderStore, makeProvider } from './msw-handlers';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

const DEFAULT_FILTER: ProviderFilter = { search: '', kinds: [] };

beforeEach(() => {
  resetProviderStore([
    makeProvider({ id: 'p1', name: 'OpenAI Prod', kind: 'openai' }),
    makeProvider({ id: 'p2', name: 'Anthropic Prod', kind: 'anthropic' }),
    makeProvider({ id: 'p3', name: 'Ollama Local', kind: 'ollama' }),
  ]);
  server.use(...aiProviderHandlers);
});

describe('ProviderList', () => {
  it('renders seeded providers for the acme tenant', async () => {
    wrap(
      <ProviderList
        tenant="acme"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTest={vi.fn()}
      />,
    );
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // header + 3 data rows
      expect(rows.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('filters by kind', async () => {
    wrap(
      <ProviderList
        tenant="acme"
        filter={{ search: '', kinds: ['openai'] }}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTest={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('OpenAI Prod')).toBeInTheDocument();
      expect(screen.queryByText('Anthropic Prod')).toBeNull();
    });
  });

  it('shows empty state when no providers match filter', async () => {
    wrap(
      <ProviderList
        tenant="acme"
        filter={{ search: 'zzz-nonexistent', kinds: [] }}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTest={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/No providers/i)).toBeInTheDocument();
    });
  });
});
