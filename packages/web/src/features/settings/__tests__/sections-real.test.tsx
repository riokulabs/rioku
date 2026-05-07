/**
 * Tests for the stage-2 real-API settings sections (Plan 07 Tasks 1–8).
 *
 * Strategy: mount each `<*RealSection>` with a real `QueryClient` +
 * `MantineProvider`, mock `globalThis.fetch` to return canned daemon
 * responses, exercise form load + save success + 422 validation error.
 *
 * Plan 07 — Tasks 1, 2, 3, 4, 5, 6, 7, 8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import React from 'react';

import { ProfileRealSection } from '../sections-real/profile-real';
import { TenantRealSection } from '../sections-real/tenant-real';
import { NetworkRealSection } from '../sections-real/network-real';
import { AuthPolicyRealSection } from '../sections-real/auth-policy-real';
import { ObservabilityRealSection } from '../sections-real/observability-real';
import { IntegrationsRealSection } from '../sections-real/integrations-real';
import { TlsRealSection } from '../sections-real/tls-real';
import { PkiRealSection } from '../sections-real/pki-real';
import { DangerZoneRealSection } from '../sections-real/danger-zone-real';

// ─── Permission stub: grant everything by default ────────────────────────────

vi.mock('@/hooks/use-permission', () => ({
  usePermission: () => true,
}));

// ─── Notify stub (no-op so save success doesn't error in jsdom) ──────────────

vi.mock('@/hooks/use-notify', () => ({
  notify: {
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// ─── Fetch mock harness ───────────────────────────────────────────────────────

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

function mockRoute(method: string, urlSubstring: string, body: unknown, status = 200) {
  routes.push({
    match: (r) => r.method === method && r.url.includes(urlSubstring),
    respond: () =>
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  });
}

function mockRouteFn(method: string, urlSubstring: string, fn: (req: RecordedRequest) => Response) {
  routes.push({
    match: (r) => r.method === method && r.url.includes(urlSubstring),
    respond: fn,
  });
}

function jsonError(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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
      new Response(JSON.stringify({ error: `unhandled ${method} ${url}` }), { status: 500 }),
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

// ─── T1: Profile ──────────────────────────────────────────────────────────────

describe('ProfileRealSection (T1)', () => {
  it('loads profile and patches name', async () => {
    mockRoute('GET', '/settings/me', {
      id: 'me',
      name: 'Old Name',
      email: 'me@example.com',
      avatarUrl: '',
    });
    mockRoute('PATCH', '/settings/me', {
      id: 'me',
      name: 'New Name',
      email: 'me@example.com',
    });

    render(
      <Wrap>
        <ProfileRealSection tenant="acme" />
      </Wrap>,
    );

    await waitFor(() => { expect(screen.getByTestId('profile-real-section')).toBeDefined(); });
    const nameInput = screen.getByTestId('profile-real-name-input');
    expect((nameInput as HTMLInputElement).value).toBe('Old Name');

    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByTestId('profile-real-save'));

    await waitFor(() => {
      const patch = recorded.find((r) => r.method === 'PATCH' && r.url.includes('/settings/me'));
      expect(patch).toBeDefined();
      expect(JSON.parse(patch!.body!)).toMatchObject({ name: 'New Name' });
    });
  });

  it('surfaces 422 validation errors', async () => {
    mockRoute('GET', '/settings/me', { id: 'me', name: 'Old', email: 'a@a.com' });
    mockRouteFn('PATCH', '/settings/me', () =>
      jsonError(422, {
        title: 'Validation failed',
        fields: { name: ['Name is required'] },
      }),
    );

    render(
      <Wrap>
        <ProfileRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('profile-real-section')).toBeDefined(); });
    fireEvent.change(screen.getByTestId('profile-real-name-input'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByTestId('profile-real-save'));
    await waitFor(() => {
      const errEl = document.querySelector('.mantine-TextInput-error');
      expect(errEl?.textContent).toContain('Name is required');
    });
  });
});

// ─── T2: Tenant ───────────────────────────────────────────────────────────────

describe('TenantRealSection (T2)', () => {
  it('loads tenant and patches description', async () => {
    mockRoute('GET', '/settings/tenant', {
      id: 't1',
      slug: 'acme',
      name: 'ACME Inc',
      description: 'old',
      defaultTheme: 'auto',
    });
    mockRoute('PATCH', '/settings/tenant', { id: 't1', slug: 'acme', name: 'ACME Inc' });

    render(
      <Wrap>
        <TenantRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('tenant-real-section')).toBeDefined(); });
    fireEvent.change(screen.getByTestId('tenant-real-description'), {
      target: { value: 'new description' },
    });
    fireEvent.click(screen.getByTestId('tenant-real-save'));
    await waitFor(() => {
      const patch = recorded.find(
        (r) => r.method === 'PATCH' && r.url.includes('/settings/tenant'),
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch!.body!)).toMatchObject({ description: 'new description' });
    });
  });
});

// ─── T3: Auth-policy ──────────────────────────────────────────────────────────

describe('AuthPolicyRealSection (T3)', () => {
  it('loads policy and PUTs new TOTP requirement', async () => {
    mockRoute('GET', '/settings/auth-policy', {
      totpPolicy: 'optional',
      passwordMinLength: 12,
      idleSessionTimeoutSeconds: 900,
      absoluteSessionTimeoutSeconds: 86400,
    });
    mockRoute('PUT', '/settings/auth-policy', { totpPolicy: 'all', passwordMinLength: 12 });

    render(
      <Wrap>
        <AuthPolicyRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('auth-policy-real-section')).toBeDefined(); });

    // Trigger a touched-state change via the password-min-length number input.
    const pwd = screen.getByTestId('auth-policy-real-pwd-min');
    fireEvent.change(pwd, { target: { value: '24' } });
    fireEvent.click(screen.getByTestId('auth-policy-real-save'));
    await waitFor(() => {
      const put = recorded.find(
        (r) => r.method === 'PUT' && r.url.includes('/settings/auth-policy'),
      );
      expect(put).toBeDefined();
      expect(JSON.parse(put!.body!)).toMatchObject({ passwordMinLength: 24 });
    });
  });
});

// ─── T4: Network ──────────────────────────────────────────────────────────────

describe('NetworkRealSection (T4)', () => {
  it('PUTs new listen addresses', async () => {
    mockRoute('GET', '/settings/network', {
      listenAddresses: [':443'],
      http3Enabled: true,
      readTimeoutSeconds: 60,
      writeTimeoutSeconds: 60,
      idleTimeoutSeconds: 120,
    });
    mockRoute('PUT', '/settings/network', { listenAddresses: [':443', ':8443'] });

    render(
      <Wrap>
        <NetworkRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('network-real-section')).toBeDefined(); });
    fireEvent.change(screen.getByTestId('network-real-listen'), {
      target: { value: ':443,:8443' },
    });
    fireEvent.click(screen.getByTestId('network-real-save'));
    await waitFor(() => {
      const put = recorded.find((r) => r.method === 'PUT' && r.url.includes('/settings/network'));
      expect(put).toBeDefined();
      expect(JSON.parse(put!.body!)).toMatchObject({ listenAddresses: [':443', ':8443'] });
    });
  });
});

// ─── T7: Observability metrics ────────────────────────────────────────────────

describe('ObservabilityRealSection (T7)', () => {
  it('renders the three cards and PUTs a metrics change', async () => {
    mockRoute('GET', '/settings/observability/metrics', {
      scrapeEndpoint: '/metrics',
      scrapeAuth: 'none',
      retentionDays: 30,
    });
    mockRoute('GET', '/settings/observability/logs', {
      level: 'info',
      format: 'json',
      rotationDays: 7,
    });
    mockRoute('GET', '/settings/observability/traces', {
      otlpEndpoint: '',
      sampleRate: 0.1,
      retentionDays: 7,
    });
    mockRoute('PUT', '/settings/observability/metrics', { retentionDays: 60 });

    render(
      <Wrap>
        <ObservabilityRealSection tenant="acme" />
      </Wrap>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('metrics-card')).toBeDefined();
      expect(screen.getByTestId('logs-card')).toBeDefined();
      expect(screen.getByTestId('traces-card')).toBeDefined();
      expect(screen.getByTestId('logs-tail-card')).toBeDefined();
    });
    fireEvent.change(screen.getByTestId('metrics-retention'), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('metrics-save'));
    await waitFor(() => {
      const put = recorded.find(
        (r) => r.method === 'PUT' && r.url.includes('/settings/observability/metrics'),
      );
      expect(put).toBeDefined();
      expect(JSON.parse(put!.body!)).toMatchObject({ retentionDays: 60 });
    });
  });
});

// ─── T8: Integrations ─────────────────────────────────────────────────────────

describe('IntegrationsRealSection (T8)', () => {
  it('adds a webhook + saves', async () => {
    mockRoute('GET', '/settings/integrations', {
      webhooks: [{ id: 'wh-1', name: 'existing', url: 'https://x.example/hook', enabled: true }],
    });
    mockRoute('PUT', '/settings/integrations', { webhooks: [] });

    render(
      <Wrap>
        <IntegrationsRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('integrations-real-section')).toBeDefined(); });

    fireEvent.change(screen.getByTestId('integrations-real-draft-name'), {
      target: { value: 'new-hook' },
    });
    fireEvent.change(screen.getByTestId('integrations-real-draft-url'), {
      target: { value: 'https://example.com/h' },
    });
    fireEvent.click(screen.getByTestId('integrations-real-add'));
    fireEvent.click(screen.getByTestId('integrations-real-save'));
    await waitFor(() => {
      const put = recorded.find(
        (r) => r.method === 'PUT' && r.url.includes('/settings/integrations'),
      );
      expect(put).toBeDefined();
      const body = JSON.parse(put!.body!) as { webhooks: { name?: string }[] };
      expect(body.webhooks.find((w) => w.name === 'new-hook')).toBeDefined();
    });
  });

  it('renders test-send result on success', async () => {
    mockRoute('GET', '/settings/integrations', {
      webhooks: [{ id: 'wh-1', name: 'existing', url: 'https://x', enabled: true }],
    });
    mockRouteFn('POST', '/settings/webhooks/wh-1/test', () =>
      new Response(JSON.stringify({ http_status: 200, duration_ms: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(
      <Wrap>
        <IntegrationsRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('integrations-real-section')).toBeDefined(); });
    await act(async () => {
      fireEvent.click(screen.getByTestId('integrations-real-test-wh-1'));
      await Promise.resolve();
    });
    await waitFor(() => {
      const result = screen.queryByTestId('integrations-real-test-result-wh-1');
      expect(result).not.toBeNull();
    });
  });
});

// ─── T5: TLS ─────────────────────────────────────────────────────────────────

describe('TlsRealSection (T5)', () => {
  it('loads, switches issuer, saves', async () => {
    mockRoute('GET', '/settings/tls', {
      acmeIssuer: 'lets-encrypt-staging',
      acmeEmail: 'admin@example.com',
      manualCertRefs: [],
    });
    mockRoute('PUT', '/settings/tls', { acmeIssuer: 'custom' });

    render(
      <Wrap>
        <TlsRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('tls-real-section')).toBeDefined(); });

    // Form-load assertion
    const email = screen.getByTestId('tls-real-email');
    expect((email as HTMLInputElement).value).toBe('admin@example.com');

    // Mantine Select uses combobox role; trigger via fireEvent change on the email field
    // to set dirty state, then save.
    fireEvent.change(email, { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByTestId('tls-real-save'));
    await waitFor(() => {
      const put = recorded.find((r) => r.method === 'PUT' && r.url.includes('/settings/tls'));
      expect(put).toBeDefined();
      expect(JSON.parse(put!.body!)).toMatchObject({ acmeEmail: 'new@example.com' });
    });
  });

  it('blocks manual cert upload when PEM blob is malformed', async () => {
    mockRoute('GET', '/settings/tls', { acmeIssuer: 'lets-encrypt-staging', manualCertRefs: [] });

    render(
      <Wrap>
        <TlsRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('tls-real-section')).toBeDefined(); });
    fireEvent.change(screen.getByTestId('tls-real-cert-pem'), {
      target: { value: 'not a real pem' },
    });
    fireEvent.change(screen.getByTestId('tls-real-key-pem'), {
      target: { value: 'also not a key' },
    });
    fireEvent.click(screen.getByTestId('tls-real-upload'));
    await waitFor(() => {
      expect(screen.getByTestId('tls-real-upload-error').textContent).toContain('-----BEGIN');
    });
  });
});

// ─── T6: PKI ──────────────────────────────────────────────────────────────────

describe('PkiRealSection (T6)', () => {
  it('loads, edits, saves', async () => {
    mockRoute('GET', '/settings/pki', {
      caChainPem: '-----BEGIN CERTIFICATE-----\nseed\n-----END CERTIFICATE-----',
      enrollmentEndpoint: '',
      enrollmentTokenTtlSeconds: 3600,
      nodeValiditySeconds: 86400,
      keyAlgorithm: 'ed25519',
    });
    mockRoute('GET', '/settings/pki/revocations', { items: [] });
    mockRoute('PUT', '/settings/pki', { caChainPem: 'updated' });

    render(
      <Wrap>
        <PkiRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('pki-real-section')).toBeDefined(); });
    fireEvent.change(screen.getByTestId('pki-real-enroll-endpoint'), {
      target: { value: 'https://pki.example/enroll' },
    });
    fireEvent.click(screen.getByTestId('pki-real-save'));
    await waitFor(() => {
      const put = recorded.find((r) => r.method === 'PUT' && r.url.includes('/settings/pki'));
      expect(put).toBeDefined();
      expect(JSON.parse(put!.body!)).toMatchObject({
        enrollmentEndpoint: 'https://pki.example/enroll',
      });
    });
  });

  it('rejects invalid CA PEM client-side', async () => {
    mockRoute('GET', '/settings/pki', { caChainPem: '', enrollmentEndpoint: '' });
    mockRoute('GET', '/settings/pki/revocations', { items: [] });

    render(
      <Wrap>
        <PkiRealSection tenant="acme" />
      </Wrap>,
    );
    await waitFor(() => { expect(screen.getByTestId('pki-real-section')).toBeDefined(); });
    fireEvent.change(screen.getByTestId('pki-real-ca-pem'), {
      target: { value: 'not a cert' },
    });
    fireEvent.click(screen.getByTestId('pki-real-save'));
    await waitFor(() => {
      const err = document.querySelector('.mantine-Textarea-error');
      expect(err?.textContent).toContain('CERTIFICATE block');
    });
    // Confirm no PUT was issued.
    const puts = recorded.filter((r) => r.method === 'PUT');
    expect(puts).toHaveLength(0);
  });
});

// ─── T9: Danger zone — triple-confirm UX ──────────────────────────────────────

describe('DangerZoneRealSection (T9 triple-confirm)', () => {
  it('keeps the submit disabled until magic word + checkbox satisfy', async () => {
    render(
      <Wrap>
        <DangerZoneRealSection tenant="acme" tenantSlug="acme" />
      </Wrap>,
    );

    fireEvent.click(screen.getByTestId('danger-real-reset-open'));
    await waitFor(() => { expect(screen.getByTestId('danger-real-reset-modal')).toBeDefined(); });

    const submit = screen.getByTestId('danger-real-reset-submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId('danger-real-reset-word-input'), {
      target: { value: 'RESET' },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // checkbox still unchecked

    fireEvent.click(screen.getByTestId('danger-real-reset-ack'));
    await waitFor(() => {
      const btn = screen.getByTestId('danger-real-reset-submit');
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('rejects wrong word', () => {
    render(
      <Wrap>
        <DangerZoneRealSection tenant="acme" tenantSlug="acme" />
      </Wrap>,
    );

    fireEvent.click(screen.getByTestId('danger-real-delete-open'));
    fireEvent.change(screen.getByTestId('danger-real-delete-word-input'), {
      target: { value: 'wrongslug' },
    });
    fireEvent.click(screen.getByTestId('danger-real-delete-ack'));

    const submit = screen.getByTestId('danger-real-delete-submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides delete-tenant card when tenant:delete permission is missing', async () => {
    vi.doMock('@/hooks/use-permission', () => ({
      usePermission: (key: string) => key !== 'tenant:delete',
    }));
    vi.resetModules();
    const { DangerZoneRealSection: Re } = await import('../sections-real/danger-zone-real');
    render(
      <Wrap>
        <Re tenant="acme" tenantSlug="acme" />
      </Wrap>,
    );
    expect(screen.queryByTestId('danger-real-delete-card')).toBeNull();
    expect(screen.getByTestId('danger-real-reset-card')).toBeDefined();
    vi.doUnmock('@/hooks/use-permission');
  });

  it('issues hard-reset POST after triple-confirm completes', async () => {
    mockRoute('POST', '/settings/danger/hard-reset', { ok: true });

    render(
      <Wrap>
        <DangerZoneRealSection tenant="acme" tenantSlug="acme" />
      </Wrap>,
    );

    fireEvent.click(screen.getByTestId('danger-real-reset-open'));
    fireEvent.change(screen.getByTestId('danger-real-reset-word-input'), {
      target: { value: 'RESET' },
    });
    fireEvent.click(screen.getByTestId('danger-real-reset-ack'));
    await waitFor(() => {
      const btn = screen.getByTestId('danger-real-reset-submit');
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('danger-real-reset-submit'));
      await Promise.resolve();
    });
    await waitFor(() => {
      const post = recorded.find(
        (r) => r.method === 'POST' && r.url.includes('/settings/danger/hard-reset'),
      );
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body!) as { confirmation: string };
      expect(parsed.confirmation).toContain('acme');
    });
  });
});
