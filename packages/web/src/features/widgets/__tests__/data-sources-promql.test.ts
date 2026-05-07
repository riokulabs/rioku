/**
 * PromQL data-source fetcher + dispatcher tests (Plan 08 T4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/mutator', () => {
  return {
    customFetch: vi.fn(),
    setAuthFailureHandler: vi.fn(),
  };
});

import { customFetch } from '@/api/mutator';
import { fetchPromQL, normalisePromQLResponse } from '../data-sources/promql';
import { fetchWidgetData, dataSourceFor } from '../data-sources/registry';
import type { DaemonWidget } from '../daemon-api';

const fetchMock = customFetch as unknown as ReturnType<typeof vi.fn>;

const baseWidget: DaemonWidget = {
  id: 'w1',
  dashboardId: 'd1',
  kind: 'line-chart',
  title: 'CPU',
  dataSource: 'promql',
  config: {},
  rawQuery: 'rate(http_requests_total[5m])',
  lockedAdvanced: true,
  layout: { x: 0, y: 0, w: 4, h: 3 },
  createdAt: '2026-05-06T00:00:00Z',
  updatedAt: '2026-05-06T00:00:00Z',
};

beforeEach(() => fetchMock.mockReset());
afterEach(() => fetchMock.mockReset());

describe('normalisePromQLResponse', () => {
  it('flattens an instant vector response', () => {
    const raw = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          { metric: { job: 'rioku' }, value: [1700000000, '42'] },
          { metric: { job: 'caddy' }, value: [1700000000, '7'] },
        ],
      },
    };
    const out = normalisePromQLResponse(raw);
    expect(out.resultType).toBe('vector');
    expect(out.series).toHaveLength(2);
    expect(out.series[0]?.points[0]).toEqual({ timestamp: 1700000000, value: 42 });
    expect(out.series[0]?.labels.job).toBe('rioku');
  });

  it('flattens a range matrix response', () => {
    const raw = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { job: 'rioku' },
            values: [
              [1700000000, '1'],
              [1700000060, '2'],
              [1700000120, '3'],
            ],
          },
        ],
      },
    };
    const out = normalisePromQLResponse(raw);
    expect(out.resultType).toBe('matrix');
    expect(out.series[0]?.points).toHaveLength(3);
  });

  it('throws on Prometheus-level error responses', () => {
    expect(() =>
      normalisePromQLResponse({ status: 'error', error: 'parse error', errorType: 'bad_data' }),
    ).toThrow(/parse error/);
  });

  it('handles an empty response gracefully', () => {
    const out = normalisePromQLResponse({ status: 'success', data: { resultType: 'vector', result: [] } });
    expect(out.series).toEqual([]);
  });
});

describe('fetchPromQL', () => {
  it('POSTs the daemon proxy URL with the query body', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 'success',
      data: { resultType: 'vector', result: [] },
    });
    await fetchPromQL('acme', { query: 'up' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/t/acme/promql/query');
    expect(init.method).toBe('POST');
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    expect(body).toEqual({ query: 'up' });
  });
});

describe('fetchWidgetData dispatcher', () => {
  it('routes promql widgets to the PromQL fetcher', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 'success',
      data: { resultType: 'vector', result: [] },
    });
    const out = await fetchWidgetData('acme', baseWidget);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect('series' in out).toBe(true);
  });

  it('throws on missing query for promql widgets', async () => {
    const broken: DaemonWidget = { ...baseWidget, rawQuery: null, config: {} };
    await expect(fetchWidgetData('acme', broken)).rejects.toThrow(/no PromQL query/);
  });

  it('returns empty rows for stub data sources', async () => {
    const auditWidget: DaemonWidget = { ...baseWidget, dataSource: 'audit', rawQuery: null };
    const out = await fetchWidgetData('acme', auditWidget);
    expect(out).toEqual({ rows: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on unknown data sources', async () => {
    const odd: DaemonWidget = { ...baseWidget, dataSource: 'made-up' };
    await expect(fetchWidgetData('acme', odd)).rejects.toThrow(/Unknown widget data source/);
  });

  it('dataSourceFor falls back to config.dataSource when top-level is empty', () => {
    const w: DaemonWidget = {
      ...baseWidget,
      dataSource: '',
      config: { dataSource: 'promql' } as unknown as DaemonWidget['config'],
    };
    expect(dataSourceFor(w)).toBe('promql');
  });
});
