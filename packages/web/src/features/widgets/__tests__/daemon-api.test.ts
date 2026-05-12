/**
 * Daemon-backed widgets API tests (Plan 08 T3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/mutator', () => {
  return {
    customFetch: vi.fn(),
    setAuthFailureHandler: vi.fn(),
  };
});

import { customFetch } from '@/api/mutator';
import {
  createWidgetViaDaemon,
  deleteWidgetViaDaemon,
  flipWidgetAdvancedViaDaemon,
  flipWidgetWizardViaDaemon,
  listWidgetsViaDaemon,
  patchWidgetViaDaemon,
  updateLayoutViaDaemon,
  updateWidgetViaDaemon,
} from '../daemon-api';
import type { DaemonWidget } from '../daemon-api';

const fetchMock = customFetch as unknown as ReturnType<typeof vi.fn>;

interface OrvalCall {
  url: string;
  method: string;
  body?: unknown;
}

function capturedCall(): OrvalCall {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error('customFetch was not called');
  const [url, init] = call as [string, RequestInit];
  const method = init.method ?? 'GET';
  let body: unknown;
  if (typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  return { url, method, ...(body !== undefined ? { body } : {}) };
}

const sampleWidget: DaemonWidget = {
  id: 'w1',
  dashboardId: 'd1',
  kind: 'line-chart',
  title: 'CPU',
  dataSource: 'promql',
  config: {},
  lockedAdvanced: false,
  layout: { x: 0, y: 0, w: 4, h: 3 },
  createdAt: '2026-05-06T00:00:00Z',
  updatedAt: '2026-05-06T00:00:00Z',
};

beforeEach(() => fetchMock.mockReset());
afterEach(() => fetchMock.mockReset());

describe('widgets daemon-api — CRUD', () => {
  it('listWidgetsViaDaemon GETs widgets under a dashboard', async () => {
    fetchMock.mockResolvedValueOnce({ items: [sampleWidget], total: 1 });
    const out = await listWidgetsViaDaemon('acme', 'd1');
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/dashboards/d1/widgets');
    expect(c.method).toBe('GET');
    expect(out.total).toBe(1);
  });

  it('createWidgetViaDaemon posts to dashboards/{id}/widgets', async () => {
    fetchMock.mockResolvedValueOnce(sampleWidget);
    await createWidgetViaDaemon('acme', 'd1', { kind: 'line-chart', title: 'CPU' });
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/dashboards/d1/widgets');
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ kind: 'line-chart', title: 'CPU' });
  });

  it('updateWidgetViaDaemon PUTs to /widgets/{id}', async () => {
    fetchMock.mockResolvedValueOnce(sampleWidget);
    await updateWidgetViaDaemon('acme', 'w1', { title: 'Updated' });
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/widgets/w1');
    expect(c.method).toBe('PUT');
  });

  it('patchWidgetViaDaemon PATCHes /widgets/{id}', async () => {
    fetchMock.mockResolvedValueOnce(sampleWidget);
    await patchWidgetViaDaemon('acme', 'w1', { title: 'Patched' });
    const c = capturedCall();
    expect(c.method).toBe('PATCH');
  });

  it('deleteWidgetViaDaemon DELETEs /dashboards/{id}/widgets/{wid}', async () => {
    fetchMock.mockResolvedValueOnce(undefined);
    await deleteWidgetViaDaemon('acme', 'd1', 'w1');
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/dashboards/d1/widgets/w1');
    expect(c.method).toBe('DELETE');
  });
});

describe('widgets daemon-api — flip', () => {
  it('flipWidgetAdvancedViaDaemon POSTs flip-advanced', async () => {
    fetchMock.mockResolvedValueOnce(sampleWidget);
    await flipWidgetAdvancedViaDaemon('acme', 'w1');
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/widgets/w1/flip-advanced');
    expect(c.method).toBe('POST');
  });

  it('flipWidgetWizardViaDaemon POSTs flip-wizard', async () => {
    fetchMock.mockResolvedValueOnce(sampleWidget);
    await flipWidgetWizardViaDaemon('acme', 'w1');
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/widgets/w1/flip-wizard');
  });
});

describe('widgets daemon-api — layout reorder', () => {
  it('updateLayoutViaDaemon sends the bulk-layout body', async () => {
    fetchMock.mockResolvedValueOnce(undefined);
    await updateLayoutViaDaemon('acme', 'd1', {
      w1: { x: 0, y: 0, w: 4, h: 3 },
      w2: { x: 4, y: 0, w: 4, h: 3 },
    });
    const c = capturedCall();
    expect(c.url).toBe('/api/v1/t/acme/dashboards/d1/layout');
    expect(c.method).toBe('PUT');
    expect(c.body).toEqual({
      layouts: {
        w1: { x: 0, y: 0, w: 4, h: 3 },
        w2: { x: 4, y: 0, w: 4, h: 3 },
      },
    });
  });
});
