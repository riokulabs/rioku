/**
 * PromQL data-source fetcher for stage-2 widgets (Plan 08 T4).
 *
 * Calls the daemon proxy at `POST /api/v1/t/{tenant}/promql/query`
 * (see `packages/daemon/internal/gateway/promql_routes.go`). The proxy
 * AST-rewrites the user query to inject the `tenant_id` label so a
 * tenant cannot read another tenant's series — this client is
 * deliberately ignorant of that detail.
 *
 * Response shape is the Prometheus HTTP API envelope, forwarded
 * verbatim. Renderers downstream (line-chart / bar / single-stat /
 * table) interpret `data.result` according to widget kind.
 */
import { queryPromQL } from '@/api/generated/promql/promql';
import type { PromQLQueryRequest, PromQLQueryResponse } from '@/api/generated/schemas';

export interface PromQLSeriesPoint {
  timestamp: number;
  value: number;
}

export interface PromQLSeries {
  labels: Record<string, string>;
  points: PromQLSeriesPoint[];
}

export interface PromQLResult {
  resultType: 'matrix' | 'vector' | 'scalar' | 'string';
  series: PromQLSeries[];
  /** Raw Prometheus envelope, kept for advanced renderers. */
  raw: PromQLQueryResponse;
}

/**
 * Run a PromQL query and normalise the response into a uniform
 * `series[]` shape. Throws on Prometheus-level errors (`status: 'error'`).
 */
export async function fetchPromQL(
  tenant: string,
  body: PromQLQueryRequest,
): Promise<PromQLResult> {
  // `customFetch` returns the parsed body; orval's wrapper response
  // type is a fiction (see `features/widgets/daemon-api.ts`). Cast
  // through `unknown` to swap the wrapper for the body schema.
  const raw = (await queryPromQL(tenant, body)) as unknown as PromQLQueryResponse;
  return normalisePromQLResponse(raw);
}

/**
 * Convert the raw Prometheus envelope into a flat series list. Pure
 * function — exported for tests.
 */
export function normalisePromQLResponse(raw: PromQLQueryResponse): PromQLResult {
  const r = raw as unknown as Record<string, unknown>;
  if (r.status === 'error') {
    const msg = typeof r.error === 'string' ? r.error : 'PromQL error';
    throw new Error(`PromQL: ${msg}`);
  }
  const data = r.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') {
    return { resultType: 'vector', series: [], raw };
  }
  const rt = data.resultType;
  const resultType: PromQLResult['resultType'] =
    rt === 'matrix' || rt === 'vector' || rt === 'scalar' || rt === 'string' ? rt : 'vector';
  const result = Array.isArray(data.result) ? (data.result as unknown[]) : [];

  const series: PromQLSeries[] = [];
  for (const rawEntry of result) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as { metric?: Record<string, string>; value?: unknown; values?: unknown };
    const labels = entry.metric ?? {};

    if (resultType === 'matrix' && Array.isArray(entry.values)) {
      const points: PromQLSeriesPoint[] = [];
      for (const pRaw of entry.values) {
        if (!Array.isArray(pRaw) || pRaw.length < 2) continue;
        const ts = Number(pRaw[0]);
        const v = Number(pRaw[1]);
        if (Number.isFinite(ts) && Number.isFinite(v)) {
          points.push({ timestamp: ts, value: v });
        }
      }
      series.push({ labels, points });
    } else if (Array.isArray(entry.value) && entry.value.length >= 2) {
      const ts = Number(entry.value[0]);
      const v = Number(entry.value[1]);
      if (Number.isFinite(ts) && Number.isFinite(v)) {
        series.push({ labels, points: [{ timestamp: ts, value: v }] });
      }
    }
  }
  return { resultType, series, raw };
}

/**
 * Convenience adapter that picks an instant or range query based on
 * presence of `start`/`end`. Used by widgets that only know "give me
 * data for this PromQL expression".
 */
export async function fetchPromQLForRange(
  tenant: string,
  query: string,
  range?: { start: string; end: string; step: string },
): Promise<PromQLResult> {
  const body: PromQLQueryRequest = range
    ? { query, start: range.start, end: range.end, step: range.step }
    : { query };
  return fetchPromQL(tenant, body);
}
