/**
 * Unit tests for MarketplaceGrid + marketplace API selectors — Stage-2.
 *
 * The selectors hit the real daemon's curated catalog endpoint via
 * `customFetch`; tests intercept with MSW and assert client-side
 * filtering on top of the daemon-supplied catalog.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { http, HttpResponse } from 'msw';
import { renderHook, waitFor, screen, fireEvent } from '@testing-library/react';
import { server } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { ModalsProvider } from '@mantine/modals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { MarketplaceGrid } from '../components/grid';
import { useMarketplaceListings } from '../api';

interface DaemonEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags?: string[];
  verified?: boolean;
  installs?: number;
}

const SAMPLE: DaemonEntry[] = [
  {
    id: 'rioku_jwt',
    name: 'JWT Auth',
    description: 'JWT validation',
    version: '1.0.0',
    author: 'Rioku Labs',
    tags: ['auth', 'security'],
    verified: true,
    installs: 1200,
  },
  {
    id: 'rioku_waf',
    name: 'WAF',
    description: 'Web application firewall',
    version: '1.0.0',
    author: 'Rioku Labs',
    tags: ['security', 'waf'],
    verified: true,
    installs: 800,
  },
  {
    id: 'community_caching',
    name: 'Community Caching',
    description: 'Community plugin',
    version: '0.1.0',
    author: 'someone',
    tags: ['perf'],
    verified: false,
    installs: 200,
  },
];

beforeEach(() => {
  server.resetHandlers();
  // Default catalog handler — both tenant-scoped + global URL.
  server.use(
    http.get(/\/api\/v1\/(?:t\/[^/]+\/)?plugin-marketplace$/, () =>
      HttpResponse.json({ items: SAMPLE, total: SAMPLE.length }),
    ),
  );
});

function wrapWithQuery(ui: React.ReactNode, qc: QueryClient) {
  return (
    <MantineProvider defaultColorScheme="dark">
      <QueryClientProvider client={qc}>
        <ModalsProvider>{ui}</ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
}

describe('MarketplaceGrid (real daemon)', () => {
  it('renders catalog entries from the daemon', async () => {
    renderWithProviders(
      <ModalsProvider>
        <MarketplaceGrid onInstall={vi.fn()} tenantSlug="tenant-1" />
      </ModalsProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('JWT Auth')).toBeTruthy();
    });
    expect(screen.getByText('WAF')).toBeTruthy();
    expect(screen.getByText('Community Caching')).toBeTruthy();
  });

  it('calls onInstall when the Install button is clicked', async () => {
    const onInstall = vi.fn();
    renderWithProviders(
      <ModalsProvider>
        <MarketplaceGrid onInstall={onInstall} tenantSlug="tenant-1" />
      </ModalsProvider>,
    );
    await waitFor(() => screen.getByText('JWT Auth'));
    const installButtons = screen.getAllByRole('button', { name: /^Install$/i });
    const first = installButtons[0];
    if (!first) throw new Error('No install buttons');
    fireEvent.click(first);
    expect(onInstall).toHaveBeenCalledOnce();
    const arg = onInstall.mock.calls[0]?.[0] as { slug: string } | undefined;
    expect(arg?.slug).toBeTruthy();
  });
});

describe('useMarketplaceListings (real daemon)', () => {
  function makeWrapper() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    return (props: { children: React.ReactNode }) =>
      wrapWithQuery(props.children, qc);
  }

  it('filters by tag intersection — all provided tags must match', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useMarketplaceListings({ search: '', tags: ['security'] }, 'tenant-1'),
      { wrapper },
    );
    await waitFor(() => { expect(result.current.length).toBeGreaterThan(0); });
    for (const l of result.current) {
      expect(l.tags).toContain('security');
    }
  });

  it('returns a smaller set when multiple tags are required', async () => {
    const wrapper = makeWrapper();
    const single = renderHook(
      () => useMarketplaceListings({ search: '', tags: ['security'] }, 'tenant-1'),
      { wrapper },
    );
    const double = renderHook(
      () => useMarketplaceListings({ search: '', tags: ['security', 'waf'] }, 'tenant-1'),
      { wrapper },
    );
    await waitFor(() => { expect(single.result.current.length).toBeGreaterThan(0); });
    await waitFor(() => { expect(double.result.current.length).toBeGreaterThanOrEqual(0); });
    expect(double.result.current.length).toBeLessThanOrEqual(single.result.current.length);
    for (const l of double.result.current) {
      expect(l.tags).toContain('security');
      expect(l.tags).toContain('waf');
    }
  });

  it('filters by name/author/slug search (case insensitive)', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useMarketplaceListings({ search: 'rioku', tags: [] }, 'tenant-1'),
      { wrapper },
    );
    await waitFor(() => { expect(result.current.length).toBeGreaterThan(0); });
    for (const l of result.current) {
      const composite = [l.display_name, l.author, l.slug].join(' ').toLowerCase();
      expect(composite).toContain('rioku');
    }
  });
});
