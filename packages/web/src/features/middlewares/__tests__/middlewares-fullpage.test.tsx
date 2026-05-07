/**
 * Real Vitest coverage for <MiddlewareFullPage>:
 *   - Renders all three tabs (Config / Bound routes / Audit).
 *   - Config tab renders Monaco editor host + invalid JSON shows error alert.
 *   - Bound routes tab lists referencing routes.
 *
 * Monaco runs in jsdom only via the mocked '@monaco-editor/react' module:
 * a thin <textarea> stand-in lets us simulate edits + blur without pulling
 * in the real editor's worker / ResizeObserver dependencies.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@monaco-editor/react', () => {
  const MockEditor = ({
    value,
    onChange,
    onMount,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
    onMount?: (editor: unknown) => void;
  }) => {
    const fakeEditor = {
      onDidBlurEditorText: (_cb: () => void) => ({ dispose: () => undefined }),
    };
    onMount?.(fakeEditor);
    return (
      <textarea
        data-testid="monaco-mock"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  };
  return { default: MockEditor };
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    // Render Link as a plain anchor for unit tests.
    <a {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import type { Middleware, Route } from '@/api/resources';
import { MiddlewareFullPage } from '../components/full-page';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

function acmeId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return acme.id;
}

function firstMiddleware(tenantId: string): Middleware {
  const state = useMockStore.getState();
  const m = Object.values(state.middlewares).find((mid) => mid.tenant_id === tenantId);
  if (!m) throw new Error('No seeded middleware for tenant');
  return m;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('<MiddlewareFullPage>', () => {
  it('renders the three tabs (Config, Bound routes, Audit)', () => {
    const tenantId = acmeId();
    const m = firstMiddleware(tenantId);
    wrap(
      <MiddlewareFullPage middlewareId={m.id} tenantId={tenantId} tenantSlug="acme" />,
    );
    expect(screen.getByTestId('middleware-tab-config')).toBeInTheDocument();
    expect(screen.getByTestId('middleware-tab-bound')).toBeInTheDocument();
    expect(screen.getByTestId('middleware-tab-audit')).toBeInTheDocument();
  });

  it('Config tab renders the Monaco-backed editor', () => {
    const tenantId = acmeId();
    const m = firstMiddleware(tenantId);
    wrap(
      <MiddlewareFullPage middlewareId={m.id} tenantId={tenantId} tenantSlug="acme" />,
    );
    // Default tab is config.
    expect(screen.getByTestId('middleware-config-editor-host')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-mock')).toBeInTheDocument();
  });

  it('Config tab shows an error alert when JSON is invalid (after edit + save attempt)', async () => {
    const tenantId = acmeId();
    const m = firstMiddleware(tenantId);
    wrap(
      <MiddlewareFullPage middlewareId={m.id} tenantId={tenantId} tenantSlug="acme" />,
    );
    const editor = screen.getByTestId('monaco-mock');
    fireEvent.change(editor, { target: { value: '{ this is not json' } });

    // Click save — validation runs and surfaces the error inline.
    fireEvent.click(screen.getByTestId('middleware-config-save'));
    await waitFor(() => {
      expect(screen.getByTestId('middleware-config-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('middleware-config-error').textContent).toMatch(/Invalid JSON/);
  });

  it('Config tab clears the error on valid JSON edit + save', async () => {
    const tenantId = acmeId();
    const m = firstMiddleware(tenantId);
    wrap(
      <MiddlewareFullPage middlewareId={m.id} tenantId={tenantId} tenantSlug="acme" />,
    );
    const editor = screen.getByTestId('monaco-mock');
    fireEvent.change(editor, { target: { value: '{ "rps": 999 }' } });
    fireEvent.click(screen.getByTestId('middleware-config-save'));
    await waitFor(() => {
      expect(screen.queryByTestId('middleware-config-error')).not.toBeInTheDocument();
    });
    // The mock-store update should have applied.
    await waitFor(() => {
      const updated = useMockStore.getState().middlewares[m.id];
      expect(updated?.config).toMatchObject({ rps: 999 });
    });
  });

  it('Bound routes tab lists routes that reference this middleware', () => {
    const tenantId = acmeId();
    const m = firstMiddleware(tenantId);

    // Inject a route in the same tenant that references this middleware.
    const state = useMockStore.getState();
    const tenantService = Object.values(state.services).find((s) => s.tenant_id === tenantId);
    if (!tenantService) throw new Error('No tenant service to attach route to');
    const now = new Date().toISOString();
    const route: Route = {
      id: 'route-bound-test-1',
      service_id: tenantService.id,
      name: 'bound-test-route',
      path: '/bound-test',
      method: 'GET',
      match_kind: 'prefix',
      strip_prefix: false,
      headers_add: {},
      headers_remove: [],
      policies: [],
      middleware_ids: [m.id],
      enabled: true,
      created_at: now,
      updated_at: now,
    };
    state.addEntity('routes', route);

    wrap(
      <MiddlewareFullPage middlewareId={m.id} tenantId={tenantId} tenantSlug="acme" />,
    );

    // Switch to Bound routes tab.
    fireEvent.click(screen.getByTestId('middleware-tab-bound'));

    expect(screen.getByTestId('middleware-bound-routes')).toBeInTheDocument();
    expect(screen.getByTestId(`bound-route-${route.id}`)).toBeInTheDocument();
    expect(screen.getByText('bound-test-route')).toBeInTheDocument();
    // Click-through link present.
    expect(screen.getByTestId(`bound-route-link-${route.id}`)).toBeInTheDocument();
  });

  it('Bound routes tab shows empty state when no routes reference the middleware', () => {
    const tenantId = acmeId();
    const m = firstMiddleware(tenantId);
    wrap(
      <MiddlewareFullPage middlewareId={m.id} tenantId={tenantId} tenantSlug="acme" />,
    );
    fireEvent.click(screen.getByTestId('middleware-tab-bound'));
    expect(screen.getByText(/No routes reference this middleware\./i)).toBeInTheDocument();
  });
});
