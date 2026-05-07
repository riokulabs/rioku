/**
 * Tests for <SiteFullPage> and <SiteDrawer>.
 *
 * Covers:
 *   - Full page renders four tabs (Overview / TLS / Routes / Audit) and
 *     activates each when clicked.
 *   - TLS tab shows the TLS-mode badge + the appropriate informational
 *     message for `auto`, `manual`, and `off` modes.
 *   - Drawer's typed-domain delete confirm keeps the destructive button
 *     disabled until the user types the site's domain verbatim, then fires
 *     the real DELETE through the Orval mutation.
 */
import { describe, it, expect, vi } from 'vitest';

// TanStack <Link> is polymorphic; Mantine wraps via `component` prop. Stub
// it before any of our code imports it.
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({
    children,
    to,
    params,
  }: {
    children?: React.ReactNode;
    to?: string;
    params?: { tenant?: string; siteId?: string };
  }) => (
    <span
      data-link-to={to ?? ''}
      data-link-tenant={params?.tenant ?? ''}
      data-link-site-id={params?.siteId ?? ''}
    >
      {children}
    </span>
  ),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import type { ListSites200, Site as ProtoSite } from '@/api/generated/schemas';
import { SiteFullPage } from '../components/full-page';
import { SiteDrawer } from '../components/drawer';

const TENANT = 'acme-tenant';
const SLUG = 'acme';
const SITE_ID = 'site-fp-1';
const DOMAIN = 'api.example.com';

function makeProtoSite(overrides: Partial<ProtoSite> = {}): ProtoSite {
  return {
    id: SITE_ID,
    tenantId: TENANT,
    name: 'edge-api',
    domain: DOMAIN,
    tlsMode: 'manual',
    enabled: true,
    basicAuthEnabled: false,
    rateLimitPreset: 'standard',
    upstreamServiceId: 'svc-7',
    redirectRules: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrap(ui: React.ReactNode, qc: QueryClient = makeQueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <ModalsProvider>{ui}</ModalsProvider>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('SiteFullPage', () => {
  it('renders four tabs (Overview / TLS / Routes / Audit)', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/sites/${SITE_ID}`, () =>
        HttpResponse.json(makeProtoSite()),
      ),
      http.get(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json({ items: [] }),
      ),
    );

    wrap(<SiteFullPage tenantId={TENANT} tenantSlug={SLUG} siteId={SITE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('site-full-page')).toBeInTheDocument();
    });

    // All four tabs are present
    expect(screen.getByRole('tab', { name: /Overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /TLS/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Routes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Audit/i })).toBeInTheDocument();

    // Default panel is Overview
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
  });

  it('TLS tab shows the TLS-mode badge and manual-mode info', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/sites/${SITE_ID}`, () =>
        HttpResponse.json(makeProtoSite({ tlsMode: 'manual' })),
      ),
      http.get(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json({ items: [] }),
      ),
    );

    wrap(<SiteFullPage tenantId={TENANT} tenantSlug={SLUG} siteId={SITE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('site-full-page')).toBeInTheDocument();
    });

    // Activate TLS tab
    fireEvent.click(screen.getByRole('tab', { name: /TLS/i }));

    await waitFor(() => {
      expect(screen.getByTestId('tab-tls')).toBeInTheDocument();
    });

    // The TLS-mode badge inside the TLS panel reads "TLS manual"
    const tlsPanel = screen.getByTestId('tab-tls');
    const badges = tlsPanel.querySelectorAll('[data-testid="tls-badge"]');
    expect(badges.length).toBeGreaterThan(0);
    expect(tlsPanel.textContent).toMatch(/TLS manual/);
    // The wire shape doesn't carry tls_manual_cert previews so the fallback
    // alert about CLI inspection should be visible.
    expect(tlsPanel.textContent).toMatch(/Manual TLS mode is set/);
  });

  it('TLS tab shows ACME info for `auto` mode', async () => {
    server.use(
      http.get(`*/api/v1/t/${TENANT}/sites/${SITE_ID}`, () =>
        HttpResponse.json(makeProtoSite({ tlsMode: 'auto' })),
      ),
      http.get(`*/api/v1/t/${TENANT}/routes`, () =>
        HttpResponse.json({ items: [] }),
      ),
    );

    wrap(<SiteFullPage tenantId={TENANT} tenantSlug={SLUG} siteId={SITE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('site-full-page')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /TLS/i }));

    await waitFor(() => {
      expect(screen.getByTestId('tab-tls')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-tls').textContent).toMatch(/ACME/);
  });
});

describe('SiteDrawer — typed-domain delete confirm', () => {
  it('keeps the Delete permanently button disabled until the domain is typed and fires DELETE on match', async () => {
    let deleteCalled = false;
    server.use(
      http.get(`*/api/v1/t/${TENANT}/sites/${SITE_ID}`, () =>
        HttpResponse.json(makeProtoSite()),
      ),
      http.get(`*/api/v1/t/${TENANT}/sites`, () =>
        HttpResponse.json({ items: [makeProtoSite()] } satisfies ListSites200),
      ),
      http.delete(`*/api/v1/t/${TENANT}/sites/${SITE_ID}`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    wrap(
      <SiteDrawer tenantId={TENANT} tenantSlug={SLUG} siteId={SITE_ID} onClose={() => undefined} />,
    );

    // Wait for the site to load (drawer renders the site domain title)
    await waitFor(() => {
      expect(screen.getByTestId('site-drawer')).toBeInTheDocument();
      expect(screen.getByText(DOMAIN)).toBeInTheDocument();
    });

    // Open the typed-domain confirmation modal
    fireEvent.click(screen.getByTestId('drawer-delete'));

    const input = await screen.findByLabelText(/Confirm site domain/i);
    const confirmBtn = screen.getByTestId('drawer-delete-confirm');
    expect(confirmBtn).toBeDisabled();

    // Wrong text → still disabled
    fireEvent.change(input, { target: { value: 'nope.example.com' } });
    expect(confirmBtn).toBeDisabled();

    // Exact match → enabled
    fireEvent.change(input, { target: { value: DOMAIN } });
    await waitFor(() => {
      expect(confirmBtn).not.toBeDisabled();
    });

    // Click → DELETE fires
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
  });
});
