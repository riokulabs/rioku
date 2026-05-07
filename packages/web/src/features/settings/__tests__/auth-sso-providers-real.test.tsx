/**
 * Plan 17b (#240) — vitest spec for AuthSsoProvidersRealSection.
 *
 * Mounts the real component with a fetch mock harness mirroring
 * sections-real.test.tsx so we exercise the generated Orval hooks
 * (useListSsoProviders / useCreateSsoProvider / usePatchSsoProvider /
 * useDeleteSsoProvider) end-to-end through the real customFetch
 * mutator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import React from 'react';

import { AuthSsoProvidersRealSection } from '../sections-real/auth-sso-providers-real';

vi.mock('@/hooks/use-permission', () => ({ usePermission: () => true }));
vi.mock('@/hooks/use-notify', () => ({
  notify: { success: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

interface RecordedRequest {
  url: string;
  method: string;
  body: string | null;
}
interface RouteHandler {
  match: (req: RecordedRequest) => boolean;
  respond: (req: RecordedRequest) => Response;
}

const routes: RouteHandler[] = [];
const recorded: RecordedRequest[] = [];

function mockRoute(
  method: string,
  urlSubstring: string,
  body: unknown,
  status = 200,
): void {
  routes.push({
    match: (r) => r.method === method && r.url.includes(urlSubstring),
    respond: () =>
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  });
}

beforeEach(() => {
  routes.length = 0;
  recorded.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : null;
    const req: RecordedRequest = { url, method, body };
    recorded.push(req);
    for (const r of routes) {
      if (r.match(req)) return Promise.resolve(r.respond(req));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: `unhandled ${method} ${url}` }), {
        status: 500,
      }),
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeQc(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = makeQc();
  return (
    <QueryClientProvider client={qc}>
      <MantineProvider>{children}</MantineProvider>
    </QueryClientProvider>
  );
}

describe('AuthSsoProvidersRealSection', () => {
  it('renders the empty state when the daemon returns no providers', async () => {
    mockRoute('GET', '/sso/providers', { items: [], total: 0 });

    render(
      <Wrap>
        <AuthSsoProvidersRealSection tenant="default" />
      </Wrap>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sso-providers-real-empty')).toBeTruthy();
    });
  });

  it('lists configured providers and shows the issuer + client id', async () => {
    mockRoute('GET', '/sso/providers', {
      items: [
        {
          id: 'sso_okta_prod',
          tenantId: 'default',
          name: 'okta-prod',
          kind: 'oidc',
          oidcIssuer: 'https://riokulabs.okta.com',
          oidcClientId: '0oa-rioku-prod',
          oidcScopes: ['openid', 'profile', 'email'],
          enabled: true,
          createdAt: '2026-05-07T00:00:00.000Z',
          updatedAt: '2026-05-07T00:00:00.000Z',
        },
      ],
      total: 1,
    });

    render(
      <Wrap>
        <AuthSsoProvidersRealSection tenant="default" />
      </Wrap>,
    );

    await waitFor(() => {
      expect(screen.getByText('okta-prod')).toBeTruthy();
    });
    expect(screen.getByText(/riokulabs\.okta\.com/u)).toBeTruthy();
    expect(screen.getByText(/0oa-rioku-prod/u)).toBeTruthy();
  });

  it('creates a new provider when the form is submitted', async () => {
    mockRoute('GET', '/sso/providers', { items: [], total: 0 });
    mockRoute(
      'POST',
      '/sso/providers',
      {
        id: 'sso_new',
        tenantId: 'default',
        name: 'new-idp',
        kind: 'oidc',
        oidcIssuer: 'https://idp.example.com',
        oidcClientId: 'cid',
        oidcScopes: ['openid'],
        enabled: true,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
      },
      201,
    );

    render(
      <Wrap>
        <AuthSsoProvidersRealSection tenant="default" />
      </Wrap>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sso-providers-real-add')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('sso-providers-real-add'));

    await waitFor(() => {
      expect(screen.getByTestId('sso-providers-real-form-name')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('sso-providers-real-form-name'), {
      target: { value: 'new-idp' },
    });
    fireEvent.change(screen.getByTestId('sso-providers-real-form-issuer'), {
      target: { value: 'https://idp.example.com' },
    });
    fireEvent.change(screen.getByTestId('sso-providers-real-form-client-id'), {
      target: { value: 'cid' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('sso-providers-real-form-submit'));
      // Yield once so React commits the in-flight mutation effect before
      // the next assertions read `recorded`.
      await Promise.resolve();
    });

    await waitFor(() => {
      const post = recorded.find(
        (r) => r.method === 'POST' && r.url.includes('/sso/providers'),
      );
      expect(post).toBeTruthy();
      const parsed = post ? (JSON.parse(post.body ?? '{}') as Record<string, unknown>) : {};
      expect(parsed.name).toBe('new-idp');
      expect(parsed.kind).toBe('oidc');
      expect(parsed.oidcIssuer).toBe('https://idp.example.com');
      expect(parsed.oidcClientId).toBe('cid');
    });
  });

  it('deletes a provider via the row action', async () => {
    let getCalls = 0;
    routes.push({
      match: (r) => r.method === 'GET' && r.url.includes('/sso/providers'),
      respond: () => {
        getCalls += 1;
        return new Response(
          JSON.stringify(
            getCalls === 1
              ? {
                  items: [
                    {
                      id: 'sso_doomed',
                      tenantId: 'default',
                      name: 'doomed',
                      kind: 'oidc',
                      oidcIssuer: 'https://idp.example.com',
                      oidcClientId: 'cid',
                      oidcScopes: [],
                      enabled: true,
                      createdAt: '2026-05-07T00:00:00.000Z',
                      updatedAt: '2026-05-07T00:00:00.000Z',
                    },
                  ],
                  total: 1,
                }
              : { items: [], total: 0 },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    mockRoute('DELETE', '/sso/providers/sso_doomed', null, 204);

    render(
      <Wrap>
        <AuthSsoProvidersRealSection tenant="default" />
      </Wrap>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sso-providers-real-delete-sso_doomed')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('sso-providers-real-delete-sso_doomed'));

    await waitFor(() => {
      expect(screen.getByTestId('sso-providers-real-delete-confirm')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('sso-providers-real-delete-confirm'));
      await Promise.resolve();
    });

    await waitFor(() => {
      const del = recorded.find(
        (r) => r.method === 'DELETE' && r.url.includes('/sso/providers/sso_doomed'),
      );
      expect(del).toBeTruthy();
    });
  });
});
