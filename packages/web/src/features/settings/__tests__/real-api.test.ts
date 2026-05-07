/**
 * Tests for the stage-2 real-daemon settings hooks (`features/settings/real-api.ts`).
 *
 * Mocks `globalThis.fetch` and asserts the exact URL, method, and body each
 * helper produces. Also exercises the React Query mutation hooks via a
 * `renderHook` wrapper to confirm they round-trip through `customFetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  deleteDangerTenant,
  getDangerExport,
  getSettingsNetwork,
  postDangerHardReset,
  postWebhookTest,
  putObservabilityLogs,
  putObservabilityMetrics,
  putObservabilityTraces,
  putSettingsAuthPolicy,
  putSettingsNetwork,
  settingsAuthPolicyUrl,
  settingsDangerDeleteTenantUrl,
  settingsDangerExportUrl,
  settingsDangerHardResetUrl,
  settingsNetworkUrl,
  settingsObservabilityLogsUrl,
  settingsObservabilityMetricsUrl,
  settingsObservabilityTracesUrl,
  settingsWebhookTestUrl,
  usePostWebhookTest,
  usePutSettingsNetwork,
} from '../real-api';

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

interface RecordedRequest {
  url: string;
  method: string;
  body: string | null;
  contentType: string | null;
  credentials: RequestCredentials | undefined;
}

const recorded: RecordedRequest[] = [];

function firstRecorded(): RecordedRequest {
  const r = recorded[0];
  if (r === undefined) throw new Error('no fetch was recorded');
  return r;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

beforeEach(() => {
  recorded.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function installFetchMock(handler: (req: RecordedRequest) => Response): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : null;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const req: RecordedRequest = {
      url,
      method,
      body,
      contentType: headers['content-type'] ?? null,
      credentials: init?.credentials,
    };
    recorded.push(req);
    return Promise.resolve(handler(req));
  });
}

// ─── URL builders ─────────────────────────────────────────────────────────────

describe('real-api URL builders', () => {
  it('encodes tenant slugs in every settings URL', () => {
    const t = 'acme org/with spaces';
    expect(settingsNetworkUrl(t)).toBe(`/t/${encodeURIComponent(t)}/settings/network`);
    expect(settingsAuthPolicyUrl(t)).toBe(`/t/${encodeURIComponent(t)}/settings/auth-policy`);
    expect(settingsObservabilityMetricsUrl(t)).toBe(
      `/t/${encodeURIComponent(t)}/settings/observability/metrics`,
    );
    expect(settingsObservabilityLogsUrl(t)).toBe(
      `/t/${encodeURIComponent(t)}/settings/observability/logs`,
    );
    expect(settingsObservabilityTracesUrl(t)).toBe(
      `/t/${encodeURIComponent(t)}/settings/observability/traces`,
    );
    expect(settingsWebhookTestUrl(t, 'wh:1/2')).toBe(
      `/t/${encodeURIComponent(t)}/settings/webhooks/${encodeURIComponent('wh:1/2')}/test`,
    );
    expect(settingsDangerHardResetUrl(t)).toBe(
      `/t/${encodeURIComponent(t)}/settings/danger/hard-reset`,
    );
    expect(settingsDangerExportUrl(t)).toBe(`/t/${encodeURIComponent(t)}/settings/danger/export`);
    expect(settingsDangerDeleteTenantUrl(t)).toBe(
      `/t/${encodeURIComponent(t)}/settings/danger/tenant`,
    );
  });
});

// ─── Plain helpers ────────────────────────────────────────────────────────────

describe('real-api plain helpers', () => {
  it('GET network reads the daemon route with credentials', async () => {
    installFetchMock(() => jsonResponse({ http3_enabled: true }));
    const cfg = await getSettingsNetwork('acme');
    expect(recorded).toHaveLength(1);
    expect(firstRecorded().url).toBe('/api/v1/t/acme/settings/network');
    expect(firstRecorded().method).toBe('GET');
    expect(firstRecorded().body).toBeNull();
    expect(firstRecorded().credentials).toBe('include');
    expect(cfg.http3_enabled).toBe(true);
  });

  it('PUT network sends JSON body with content-type header', async () => {
    installFetchMock(() => jsonResponse({ http3_enabled: false }));
    await putSettingsNetwork('acme', { http3_enabled: false, listen_addresses: [':443'] });
    expect(firstRecorded().method).toBe('PUT');
    expect(firstRecorded().url).toBe('/api/v1/t/acme/settings/network');
    expect(firstRecorded().contentType).toBe('application/json');
    expect(JSON.parse(firstRecorded().body ?? 'null')).toEqual({
      http3_enabled: false,
      listen_addresses: [':443'],
    });
  });

  it('PUT auth-policy uses the auth-policy endpoint', async () => {
    installFetchMock(() => jsonResponse({}));
    await putSettingsAuthPolicy('acme', {
      totp_policy: 'admins',
      password_min_length: 12,
      idle_session_timeout_seconds: 1800,
      absolute_session_timeout_seconds: 86400,
    });
    expect(firstRecorded().url).toBe('/api/v1/t/acme/settings/auth-policy');
    expect(firstRecorded().method).toBe('PUT');
    expect(JSON.parse(firstRecorded().body ?? 'null')).toMatchObject({ totp_policy: 'admins' });
  });

  it('PUT observability targets metrics / logs / traces sub-paths separately', async () => {
    installFetchMock(() => jsonResponse({}));
    await putObservabilityMetrics('acme', { retention_days: 30 });
    await putObservabilityLogs('acme', { level: 'warn' });
    await putObservabilityTraces('acme', { sample_rate: 0.1 });
    expect(recorded.map((r) => r.url)).toEqual([
      '/api/v1/t/acme/settings/observability/metrics',
      '/api/v1/t/acme/settings/observability/logs',
      '/api/v1/t/acme/settings/observability/traces',
    ]);
    expect(recorded.every((r) => r.method === 'PUT')).toBe(true);
  });

  it('POST webhook test posts to the test sub-path with no body', async () => {
    installFetchMock(() => jsonResponse({ http_status: 200, duration_ms: 12 }));
    const out = await postWebhookTest('acme', 'wh-42');
    expect(firstRecorded().url).toBe('/api/v1/t/acme/settings/webhooks/wh-42/test');
    expect(firstRecorded().method).toBe('POST');
    expect(firstRecorded().body).toBeNull();
    expect(out.http_status).toBe(200);
  });

  it('POST danger hard-reset sends the typed confirmation', async () => {
    installFetchMock(() => jsonResponse({ ok: true }));
    await postDangerHardReset('acme', { confirmation: 'acme\nacme\nacme' });
    expect(firstRecorded().url).toBe('/api/v1/t/acme/settings/danger/hard-reset');
    expect(firstRecorded().method).toBe('POST');
    expect(JSON.parse(firstRecorded().body ?? 'null')).toEqual({
      confirmation: 'acme\nacme\nacme',
    });
  });

  it('GET danger export returns daemon JSON blob', async () => {
    const blob = { schema: 'rioku.tenant-export.v1', data: { sites: [] } };
    installFetchMock(() => jsonResponse(blob));
    const out = await getDangerExport('acme');
    expect(firstRecorded().url).toBe('/api/v1/t/acme/settings/danger/export');
    expect(firstRecorded().method).toBe('GET');
    expect(out).toEqual(blob);
  });

  it('DELETE danger tenant issues DELETE on the tenant route', async () => {
    installFetchMock(() => emptyResponse(204));
    await deleteDangerTenant('acme');
    expect(firstRecorded().url).toBe('/api/v1/t/acme/settings/danger/tenant');
    expect(firstRecorded().method).toBe('DELETE');
  });
});

// ─── React Query hook integration ─────────────────────────────────────────────

function makeWrapper(): React.FC<{ children: React.ReactNode }> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return Wrapper;
}

describe('real-api React Query hooks', () => {
  it('usePutSettingsNetwork mutation calls PUT once and surfaces the response', async () => {
    installFetchMock(() => jsonResponse({ http3_enabled: true }));
    const wrapper = makeWrapper();
    const { result } = renderHook(() => usePutSettingsNetwork('acme'), { wrapper });

    result.current.mutate({ http3_enabled: true });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toEqual({ http3_enabled: true });
    expect(recorded).toHaveLength(1);
    expect(firstRecorded().method).toBe('PUT');
    expect(firstRecorded().url).toBe('/api/v1/t/acme/settings/network');
  });

  it('usePostWebhookTest mutation forwards the webhook id into the URL path', async () => {
    installFetchMock(() => jsonResponse({ http_status: 202 }));
    const wrapper = makeWrapper();
    const { result } = renderHook(() => usePostWebhookTest('acme'), { wrapper });

    result.current.mutate('wh-99');

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(firstRecorded().url).toBe('/api/v1/t/acme/settings/webhooks/wh-99/test');
    expect(firstRecorded().method).toBe('POST');
    expect(result.current.data).toEqual({ http_status: 202 });
  });

  it('mutation surfaces server errors as ApiError', async () => {
    installFetchMock(() =>
      new Response(JSON.stringify({ title: 'webhook not found' }), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    const wrapper = makeWrapper();
    const { result } = renderHook(() => usePostWebhookTest('acme'), { wrapper });

    result.current.mutate('missing');

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(result.current.error?.message).toContain('webhook not found');
  });
});
