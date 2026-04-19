/**
 * Unit tests for MarketplaceGrid + marketplace API selectors.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, renderHook, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { MarketplaceGrid } from '../components/grid';
import { useMarketplaceListings } from '../api';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('MarketplaceGrid', () => {
  it('renders all 20 seeded marketplace listings', () => {
    wrap(<MarketplaceGrid onInstall={vi.fn()} />);

    // 20 Install buttons — one per card
    const installButtons = screen.getAllByRole('button', { name: /Install/i });
    expect(installButtons.length).toBeGreaterThanOrEqual(20);
  });

  it('calls onInstall when the Install button is clicked', () => {
    const onInstall = vi.fn();
    wrap(<MarketplaceGrid onInstall={onInstall} />);

    const installButtons = screen.getAllByRole('button', { name: /^Install$/i });
    const first = installButtons[0];
    if (!first) throw new Error('No install buttons');
    fireEvent.click(first);

    expect(onInstall).toHaveBeenCalledOnce();
    const arg = onInstall.mock.calls[0]?.[0] as { slug: string } | undefined;
    expect(arg?.slug).toBeTruthy();
  });
});

describe('useMarketplaceListings selector', () => {
  it('filters by tag intersection — all provided tags must match', () => {
    // Search for 'security' — should yield multiple
    const { result } = renderHook(() =>
      useMarketplaceListings({ search: '', tags: ['security'] }),
    );
    expect(result.current.length).toBeGreaterThan(0);
    for (const l of result.current) {
      expect(l.tags).toContain('security');
    }
  });

  it('returns a smaller set when multiple tags are required', () => {
    const { result: single } = renderHook(() =>
      useMarketplaceListings({ search: '', tags: ['security'] }),
    );
    const { result: double } = renderHook(() =>
      useMarketplaceListings({ search: '', tags: ['security', 'waf'] }),
    );
    expect(double.current.length).toBeLessThanOrEqual(single.current.length);
    for (const l of double.current) {
      expect(l.tags).toContain('security');
      expect(l.tags).toContain('waf');
    }
  });

  it('filters by name/author/slug search (case insensitive)', () => {
    const { result } = renderHook(() =>
      useMarketplaceListings({ search: 'rioku', tags: [] }),
    );
    expect(result.current.length).toBeGreaterThan(0);
    for (const l of result.current) {
      const composite = [l.display_name, l.author, l.slug].join(' ').toLowerCase();
      expect(composite).toContain('rioku');
    }
  });
});
