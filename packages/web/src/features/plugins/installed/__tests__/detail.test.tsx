/**
 * Unit tests for <InstalledPluginDetail> — Stage-2.
 *
 * The detail view now fetches the plugin record via the real daemon
 * endpoint; tests intercept with MSW. The signer chip + build-log
 * accordion behaviour is unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a {...(props as Record<string, unknown>)}>{children}</a>
  ),
}));

import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { InstalledPluginDetail } from '../components/detail';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
}

interface DaemonPlugin {
  id: string;
  tenantScope: string | null;
  slug: string;
  name: string;
  version: string;
  enabled: boolean;
  buildState: string;
  cosignVerified: boolean;
  signerId: string | null;
  config: unknown;
  metadata: unknown;
  installedAt: string;
  updatedAt: string;
}

function makeDaemonPlugin(overrides: Partial<DaemonPlugin> = {}): DaemonPlugin {
  return {
    id: overrides.id ?? 'p-1',
    tenantScope: overrides.tenantScope ?? 'tenant-1',
    slug: overrides.slug ?? 'com.acme.demo',
    name: overrides.name ?? 'Acme Demo',
    version: overrides.version ?? '1.0.0',
    enabled: overrides.enabled ?? true,
    buildState: overrides.buildState ?? 'stable',
    cosignVerified: overrides.cosignVerified ?? true,
    signerId: overrides.signerId ?? null,
    config: {},
    metadata: {},
    installedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  server.resetHandlers();
});

describe('<InstalledPluginDetail> — signer chip (real daemon)', () => {
  it('renders the signer chip with short fingerprint for signed plugins', async () => {
    const dp = makeDaemonPlugin({ signerId: 'signer-1' });
    server.use(
      http.get(/\/api\/v1\/t\/[^/]+\/plugins\/p-1$/, () => HttpResponse.json(dp)),
      http.get(/\/api\/v1\/(t\/[^/]+|admin)\/plugin-signers\/signer-1$/, () =>
        HttpResponse.json({
          id: 'signer-1',
          tenantScope: 'tenant-1',
          name: 'Acme Publisher',
          fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          status: 'verified',
          notes: '',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        }),
      ),
    );

    wrap(
      <InstalledPluginDetail
        pluginId="p-1"
        tenantSlug="tenant-1"
        onUninstall={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const chip = await waitFor(() => screen.getByTestId('plugin-signer-chip'));
    expect(chip.textContent).toContain('Acme Publisher');
    expect(chip.textContent).toContain('aaaaaaaa');
    expect(chip.getAttribute('data-status')).toBe('verified');
  });

  it('renders the Unsigned chip when the plugin has no signer', async () => {
    const dp = makeDaemonPlugin({ id: 'p-2', signerId: null });
    server.use(
      http.get(/\/api\/v1\/t\/[^/]+\/plugins\/p-2$/, () => HttpResponse.json(dp)),
    );

    wrap(
      <InstalledPluginDetail
        pluginId="p-2"
        tenantSlug="tenant-1"
        onUninstall={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => screen.getByTestId('plugin-signer-chip-unsigned'));
    expect(screen.getByTestId('plugin-signer-chip-unsigned')).toBeTruthy();
  });
});
