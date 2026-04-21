/**
 * Widget data-source adapters (Plan 4 §4a.5).
 *
 * Each adapter is a pure function that takes a Widget and a snapshot of the
 * mock store state and returns the widget's rendered data. Adapters honour
 * the widget's wizard_state (dimensions / measures / filters / group_by /
 * order_by / limit) over the source records.
 *
 * For widgets in advanced mode (`raw_query` is non-empty), adapters parse
 * the query text as JSON matching the `AdvancedQuery` schema below and
 * apply it instead of wizard_state. A parse failure surfaces as a
 * `WidgetQueryError` with the parse error detail.
 *
 * The 'mock' adapter synthesises 20 deterministic rows per widget so
 * renderers can be exercised without real data.
 */
import type {
  AuditEntry,
  DashboardVariable,
  Route,
  Service,
  Widget,
  NotificationItem,
  AiTrace,
  WidgetWizardState,
} from '@/api/resources/types';
import type { MockStore } from '@/api/mock-store';

// ─── Errors ───────────────────────────────────────────────────────────────────

export class WidgetQueryError extends Error {
  readonly code = 'WIDGET_QUERY_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'WidgetQueryError';
  }
}

// ─── Advanced-query JSON shape ────────────────────────────────────────────────

export interface AdvancedQuery {
  filters?: { field: string; op: WidgetWizardState['filters'][number]['op']; value: unknown }[];
  group_by?: string;
  aggregate?: { field: string; op: 'count' | 'sum' | 'avg' | 'min' | 'max' };
  order_by?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

/** Normalised query — wizard_state → AdvancedQuery shape or raw advanced parse. */
interface NormalizedQuery {
  filters: AdvancedQuery['filters'];
  group_by?: string;
  aggregate?: AdvancedQuery['aggregate'];
  order_by?: AdvancedQuery['order_by'];
  limit?: number;
}

function normalizeWizardState(ws: WidgetWizardState): NormalizedQuery {
  return {
    filters: ws.filters,
    ...(ws.group_by !== undefined ? { group_by: ws.group_by } : {}),
    ...(ws.measures[0] !== undefined
      ? { aggregate: { field: ws.measures[0].field, op: ws.measures[0].aggregation } }
      : {}),
    ...(ws.order_by !== undefined ? { order_by: ws.order_by } : {}),
    ...(ws.limit !== undefined ? { limit: ws.limit } : {}),
  };
}

function parseAdvancedQuery(raw: string): NormalizedQuery {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (e) {
    throw new WidgetQueryError(`Invalid query: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new WidgetQueryError('Invalid query: expected object');
  }
  const q = parsed as AdvancedQuery;
  return {
    filters: q.filters ?? [],
    ...(q.group_by !== undefined ? { group_by: q.group_by } : {}),
    ...(q.aggregate !== undefined ? { aggregate: q.aggregate } : {}),
    ...(q.order_by !== undefined ? { order_by: q.order_by } : {}),
    ...(q.limit !== undefined ? { limit: q.limit } : {}),
  };
}

// ─── Variable substitution ────────────────────────────────────────────────────

/**
 * Replace `$name` tokens in a raw-query string using the dashboard variables.
 *
 * Stage-1 rules:
 *  - `$name` is substituted with `variable.default`.
 *  - Unknown `$name` tokens are left untouched (never throw) so the adapter's
 *    downstream JSON parse surfaces the error instead.
 *  - Tokens inside string literals are substituted too (naive textual
 *    substitution — sufficient for the current mock JSON syntax).
 */
export function substituteVariables(
  raw: string,
  variables: readonly DashboardVariable[],
): string {
  if (raw.length === 0 || variables.length === 0) return raw;
  // Map for quick lookup. Variable names must match the `$name` regex below.
  const byName = new Map<string, string>();
  for (const v of variables) byName.set(v.name, v.default);
  return raw.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name: string) => {
    return byName.get(name) ?? match;
  });
}

function resolveQuery(widget: Widget, variables: readonly DashboardVariable[]): NormalizedQuery {
  if (widget.raw_query.trim().length > 0) {
    return parseAdvancedQuery(substituteVariables(widget.raw_query, variables));
  }
  if (widget.wizard_state !== undefined) return normalizeWizardState(widget.wizard_state);
  return { filters: [] };
}

// ─── Filter + aggregate helpers ───────────────────────────────────────────────

function fieldValue(rec: Record<string, unknown>, field: string): unknown {
  return rec[field];
}

function matchesFilter(
  rec: Record<string, unknown>,
  f: NonNullable<AdvancedQuery['filters']>[number],
): boolean {
  const v = fieldValue(rec, f.field);
  switch (f.op) {
    case '==':
      return v === f.value;
    case '!=':
      return v !== f.value;
    case '>':
      return typeof v === 'number' && typeof f.value === 'number' && v > f.value;
    case '<':
      return typeof v === 'number' && typeof f.value === 'number' && v < f.value;
    case 'in':
      return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
    case 'contains':
      return (
        typeof v === 'string' && typeof f.value === 'string' && v.toLowerCase().includes(f.value.toLowerCase())
      );
    default:
      return false;
  }
}

function applyFilters<R extends Record<string, unknown>>(
  rows: R[],
  filters: NormalizedQuery['filters'],
): R[] {
  if (!filters || filters.length === 0) return rows;
  return rows.filter((row) => filters.every((f) => matchesFilter(row, f)));
}

function aggregate(
  values: number[],
  op: NonNullable<AdvancedQuery['aggregate']>['op'],
): number {
  if (op === 'count') return values.length;
  if (values.length === 0) return 0;
  if (op === 'sum') return values.reduce((a, b) => a + b, 0);
  if (op === 'avg') return values.reduce((a, b) => a + b, 0) / values.length;
  if (op === 'min') return values.reduce((a, b) => (a < b ? a : b));
  // op === 'max' (only remaining case)
  return values.reduce((a, b) => (a > b ? a : b));
}

// ─── Safe coercion helpers ────────────────────────────────────────────────────

/** Stringify a row value, avoiding '[object Object]'. */
function asString(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function rowGet(row: Record<string, unknown>, field: string): unknown {
  return row[field];
}

function applyGroupAggregate<R extends Record<string, unknown>>(
  rows: R[],
  query: NormalizedQuery,
): { groups: { key: string; value: number }[]; raw: R[] } {
  if (query.group_by === undefined || query.aggregate === undefined) return { groups: [], raw: rows };

  const bucket = new Map<string, number[]>();
  for (const row of rows) {
    const key = asString(rowGet(row, query.group_by), 'unknown');
    const n = asNumber(rowGet(row, query.aggregate.field));
    const arr = bucket.get(key) ?? [];
    arr.push(n);
    bucket.set(key, arr);
  }
  let groups: { key: string; value: number }[] = [];
  for (const [k, vs] of bucket.entries()) groups.push({ key: k, value: aggregate(vs, query.aggregate.op) });

  if (query.order_by !== undefined) {
    const dir = query.order_by.direction === 'desc' ? -1 : 1;
    groups = groups.slice().sort((a, b) => {
      if (query.order_by?.field === 'value') return (a.value - b.value) * dir;
      return a.key.localeCompare(b.key) * dir;
    });
  }
  if (query.limit !== undefined) groups = groups.slice(0, query.limit);
  return { groups, raw: rows };
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

type AdapterFn = (widget: Widget, state: MockStore) => unknown;

function tenantFilter<T extends { tenant_id?: string | null }>(rows: T[], tenantId: string | null): T[] {
  if (tenantId === null) return rows;
  return rows.filter((r) => r.tenant_id === tenantId || r.tenant_id === null);
}

function coerceRows(arr: readonly unknown[]): Record<string, unknown>[] {
  return arr as unknown as Record<string, unknown>[];
}

/**
 * Resolve the dashboard variables relevant for the widget (if any). When the
 * widget's dashboard is not found (e.g. the widget was detached in a bad
 * restore), variable substitution is a no-op.
 */
function widgetVariables(widget: Widget, state: MockStore): readonly DashboardVariable[] {
  const dashboard = state.dashboards[widget.dashboard_id];
  return dashboard?.variables ?? [];
}

function auditAdapter(widget: Widget, state: MockStore): unknown {
  const query = resolveQuery(widget, widgetVariables(widget, state));
  const tenantId = state.currentTenantId;
  const rows = applyFilters(
    coerceRows(tenantFilter<AuditEntry>(state.audit, tenantId)),
    query.filters,
  );
  return finalShape(widget, rows, query);
}

function servicesAdapter(widget: Widget, state: MockStore): unknown {
  const query = resolveQuery(widget, widgetVariables(widget, state));
  const tenantId = state.currentTenantId;
  const services: Service[] = tenantFilter<Service>(Object.values(state.services), tenantId);
  const rows = applyFilters(coerceRows(services), query.filters);
  return finalShape(widget, rows, query);
}

function routesAdapter(widget: Widget, state: MockStore): unknown {
  const query = resolveQuery(widget, widgetVariables(widget, state));
  const routes: Route[] = Object.values(state.routes);
  const rows = applyFilters(coerceRows(routes), query.filters);
  return finalShape(widget, rows, query);
}

function tracesAdapter(widget: Widget, state: MockStore): unknown {
  const query = resolveQuery(widget, widgetVariables(widget, state));
  const tenantId = state.currentTenantId;
  const traces: AiTrace[] = tenantFilter<AiTrace>(Object.values(state.aiTraces), tenantId);
  const rows = applyFilters(coerceRows(traces), query.filters);
  return finalShape(widget, rows, query);
}

function notificationsAdapter(widget: Widget, state: MockStore): unknown {
  const query = resolveQuery(widget, widgetVariables(widget, state));
  const notifs: NotificationItem[] = Object.values(state.notifications);
  const rows = applyFilters(coerceRows(notifs), query.filters);
  return finalShape(widget, rows, query);
}

/** djb2 string hash — deterministic widget-id → number. */
function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

// ─── Rich mock data generators (kind-specific) ────────────────────────────────

/**
 * Seeded pseudo-random: cheap deterministic float in [0,1).
 * Uses a simple LCG seeded from the widget id hash + offset.
 */
function seededRand(seed: number, i: number): number {
  const s = (seed * 1664525 + i * 22695477 + 1013904223) & 0xffffffff;
  return (s >>> 0) / 0x100000000;
}

/** Sinusoidal trend + noise for a more realistic time-series look. */
function trendPoint(seed: number, i: number, base: number, amplitude: number, period = 24): number {
  const trend = Math.sin((i / period) * Math.PI * 2) * amplitude;
  const noise = (seededRand(seed, i * 3 + 1) - 0.5) * amplitude * 0.4;
  return Math.max(0, Math.round(base + trend + noise));
}

/**
 * Generate hourly timestamps going back `count` hours from now.
 * Returns labels like "Apr 14 06:00".
 */
function hourlyLabels(count: number): string[] {
  const labels: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3_600_000);
    const mon = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const hr = String(d.getHours()).padStart(2, '0');
    labels.push(`${mon} ${String(day)} ${hr}:00`);
  }
  return labels;
}

function dailyLabels(count: number): string[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const labels: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    labels.push(days[d.getDay()] ?? `Day ${String(i)}`);
  }
  return labels;
}

function mockSingleStat(widget: Widget): unknown {
  const seed = hashCode(widget.id);
  const title = widget.title.toLowerCase();
  let value: number;
  let unit: string | undefined;
  let delta: number | undefined;

  if (title.includes('latency') || title.includes('p95') || title.includes('p99')) {
    value = 80 + Math.round(seededRand(seed, 1) * 120);
    unit = 'ms';
    delta = Math.round((seededRand(seed, 2) - 0.5) * 20);
  } else if (title.includes('error') || title.includes('rate')) {
    value = parseFloat((seededRand(seed, 3) * 2.5).toFixed(2));
    unit = '%';
    delta = parseFloat(((seededRand(seed, 4) - 0.5) * 0.8).toFixed(2));
  } else if (title.includes('uptime')) {
    value = parseFloat((99 + seededRand(seed, 5) * 0.95).toFixed(3));
    unit = '%';
    delta = parseFloat(((seededRand(seed, 6) - 0.5) * 0.02).toFixed(3));
  } else if (title.includes('token')) {
    value = Math.round(120_000 + seededRand(seed, 7) * 80_000);
    delta = Math.round((seededRand(seed, 8) - 0.4) * 20_000);
  } else if (title.includes('cost') || title.includes('spend') || title.includes('billing')) {
    value = parseFloat((80 + seededRand(seed, 9) * 220).toFixed(2));
    unit = 'USD';
    delta = parseFloat(((seededRand(seed, 10) - 0.5) * 30).toFixed(2));
  } else if (title.includes('session') || title.includes('active')) {
    value = Math.round(40 + seededRand(seed, 11) * 160);
    delta = Math.round((seededRand(seed, 12) - 0.5) * 30);
  } else if (title.includes('invocation') || title.includes('call')) {
    value = Math.round(3_200 + seededRand(seed, 13) * 8_800);
    delta = Math.round((seededRand(seed, 14) - 0.4) * 1_000);
  } else if (title.includes('threat') || title.includes('fail') || title.includes('login')) {
    value = Math.round(seededRand(seed, 15) * 48);
    delta = Math.round((seededRand(seed, 16) - 0.3) * 10);
  } else {
    // generic request count
    value = Math.round(10_000 + seededRand(seed, 17) * 90_000);
    delta = Math.round((seededRand(seed, 18) - 0.4) * 5_000);
  }
  return { value, unit, delta };
}

function mockTimeSeries(widget: Widget): unknown {
  const seed = hashCode(widget.id);
  const title = widget.title.toLowerCase();
  const COUNT = 48; // 48 hourly points
  const labels = hourlyLabels(COUNT);

  if (title.includes('latency') || title.includes('p5') || title.includes('p9')) {
    // Multi-series: p50, p95, p99
    const points = labels.map((x, i) => ({
      x,
      p50: trendPoint(seed, i, 45, 15, 24),
      p95: trendPoint(seed + 1, i, 120, 40, 24),
      p99: trendPoint(seed + 2, i, 200, 60, 24),
    }));
    return {
      points,
      series: [
        { name: 'p50', color: 'teal.5' },
        { name: 'p95', color: 'blue.5' },
        { name: 'p99', color: 'red.5' },
      ],
    };
  }

  if (title.includes('request') || title.includes('traffic')) {
    const points = labels.map((x, i) => ({
      x,
      requests: trendPoint(seed, i, 2_400, 800, 24),
      errors: trendPoint(seed + 1, i, 48, 20, 24),
    }));
    return {
      points,
      series: [
        { name: 'requests', color: 'blue.5' },
        { name: 'errors', color: 'red.5' },
      ],
    };
  }

  if (title.includes('invocation') || title.includes('ai')) {
    const points = labels.map((x, i) => ({
      x,
      invocations: trendPoint(seed, i, 320, 120, 24),
    }));
    return {
      points,
      series: [{ name: 'invocations', color: 'violet.5' }],
    };
  }

  if (title.includes('spend') || title.includes('cost') || title.includes('billing')) {
    const dailyLabelsArr = dailyLabels(30);
    const points = dailyLabelsArr.map((x, i) => ({
      x,
      spend: trendPoint(seed, i, 12, 4, 7),
    }));
    return {
      points,
      series: [{ name: 'spend', color: 'orange.5' }],
    };
  }

  // Fallback: generic value series
  const points = labels.map((x, i) => ({
    x,
    value: trendPoint(seed, i, 500, 200, 24),
  }));
  return {
    points,
    series: [{ name: 'value', color: 'blue.5' }],
  };
}

function mockStackedBar(widget: Widget): unknown {
  const seed = hashCode(widget.id);
  const title = widget.title.toLowerCase();
  const labels = dailyLabels(7);

  if (title.includes('status') || title.includes('http')) {
    const categories = labels.map((label, i) => ({
      label,
      '2xx': trendPoint(seed, i, 3_200, 600, 7),
      '3xx': trendPoint(seed + 1, i, 120, 30, 7),
      '4xx': trendPoint(seed + 2, i, 180, 60, 7),
      '5xx': trendPoint(seed + 3, i, 24, 15, 7),
    }));
    return {
      categories,
      series: [
        { name: '2xx', color: 'teal.5' },
        { name: '3xx', color: 'blue.5' },
        { name: '4xx', color: 'yellow.5' },
        { name: '5xx', color: 'red.5' },
      ],
    };
  }

  if (title.includes('token') || title.includes('model')) {
    const models = ['gpt-4o', 'claude-3', 'gemini-pro', 'llama-3'];
    const categories = labels.map((label, i) => ({
      label,
      ...Object.fromEntries(models.map((m, mi) => [m, trendPoint(seed + mi, i, 8_000, 3_000, 7)])),
    }));
    return {
      categories,
      series: [
        { name: 'gpt-4o', color: 'teal.5' },
        { name: 'claude-3', color: 'violet.5' },
        { name: 'gemini-pro', color: 'blue.5' },
        { name: 'llama-3', color: 'orange.5' },
      ],
    };
  }

  // Generic: requests by service
  const services = ['api', 'auth', 'billing', 'worker'];
  const categories = labels.map((label, i) => ({
    label,
    ...Object.fromEntries(services.map((s, si) => [s, trendPoint(seed + si, i, 1_200, 400, 7)])),
  }));
  return {
    categories,
    series: [
      { name: 'api', color: 'blue.5' },
      { name: 'auth', color: 'teal.5' },
      { name: 'billing', color: 'orange.5' },
      { name: 'worker', color: 'violet.5' },
    ],
  };
}

function mockPie(widget: Widget): unknown {
  const seed = hashCode(widget.id);
  const title = widget.title.toLowerCase();

  if (title.includes('severity')) {
    return {
      slices: [
        { name: 'Critical', value: 4 + Math.round(seededRand(seed, 1) * 8), color: 'red.5' },
        { name: 'High', value: 12 + Math.round(seededRand(seed, 2) * 18), color: 'orange.5' },
        { name: 'Medium', value: 28 + Math.round(seededRand(seed, 3) * 30), color: 'yellow.5' },
        { name: 'Low', value: 40 + Math.round(seededRand(seed, 4) * 40), color: 'blue.5' },
        { name: 'Info', value: 60 + Math.round(seededRand(seed, 5) * 60), color: 'gray.5' },
      ],
    };
  }

  if (title.includes('provider')) {
    return {
      slices: [
        { name: 'OpenAI', value: 38 + Math.round(seededRand(seed, 1) * 20), color: 'teal.5' },
        { name: 'Anthropic', value: 28 + Math.round(seededRand(seed, 2) * 15), color: 'violet.5' },
        { name: 'Google', value: 18 + Math.round(seededRand(seed, 3) * 10), color: 'blue.5' },
        { name: 'Meta', value: 10 + Math.round(seededRand(seed, 4) * 8), color: 'orange.5' },
        { name: 'Other', value: 6 + Math.round(seededRand(seed, 5) * 5), color: 'gray.5' },
      ],
    };
  }

  if (title.includes('category') || title.includes('spend') || title.includes('cost')) {
    return {
      slices: [
        { name: 'AI inference', value: 42 + Math.round(seededRand(seed, 1) * 20), color: 'violet.5' },
        { name: 'Compute', value: 26 + Math.round(seededRand(seed, 2) * 15), color: 'blue.5' },
        { name: 'Storage', value: 14 + Math.round(seededRand(seed, 3) * 10), color: 'teal.5' },
        { name: 'Network', value: 10 + Math.round(seededRand(seed, 4) * 8), color: 'orange.5' },
        { name: 'Support', value: 8 + Math.round(seededRand(seed, 5) * 5), color: 'gray.5' },
      ],
    };
  }

  // Generic fallback
  return {
    slices: [
      { name: 'Category A', value: 35 + Math.round(seededRand(seed, 1) * 20), color: 'blue.5' },
      { name: 'Category B', value: 25 + Math.round(seededRand(seed, 2) * 15), color: 'teal.5' },
      { name: 'Category C', value: 20 + Math.round(seededRand(seed, 3) * 10), color: 'violet.5' },
      { name: 'Category D', value: 12 + Math.round(seededRand(seed, 4) * 8), color: 'orange.5' },
      { name: 'Other', value: 8 + Math.round(seededRand(seed, 5) * 5), color: 'gray.5' },
    ],
  };
}

function mockTopN(widget: Widget): unknown {
  const seed = hashCode(widget.id);
  const title = widget.title.toLowerCase();

  let names: string[];
  let baseValue: number;
  let unit: string | undefined;

  if (title.includes('route') || title.includes('endpoint')) {
    names = [
      '/api/v1/completions', '/api/v1/chat', '/api/v1/embeddings',
      '/auth/token', '/api/v1/models', '/health', '/api/v1/files',
      '/api/v1/fine-tunes', '/api/v1/images', '/api/v1/audio',
    ];
    baseValue = 18_000;
  } else if (title.includes('agent')) {
    names = [
      'code-assistant', 'doc-generator', 'data-analyzer',
      'test-writer', 'security-scanner', 'summarizer',
      'translator', 'sql-assistant', 'review-bot', 'deploy-bot',
    ];
    baseValue = 3_200;
  } else if (title.includes('login') || title.includes('fail') || title.includes('source')) {
    names = [
      '185.220.101.44', '23.129.64.141', '185.220.101.33',
      '51.77.135.89', '45.142.212.100', '194.165.16.77',
      '104.244.73.26', '5.188.10.180', '89.248.167.131', '193.32.162.50',
    ];
    baseValue = 400;
  } else if (title.includes('cost') || title.includes('driver')) {
    names = [
      'GPT-4o completions', 'Claude-3 Opus', 'Gemini Ultra',
      'Embedding jobs', 'Fine-tuning runs', 'Image generation',
      'Audio transcription', 'Vector search', 'Reranking calls', 'Tool use',
    ];
    baseValue = 120;
    unit = 'USD';
  } else {
    names = [
      'service-alpha', 'service-beta', 'service-gamma', 'service-delta',
      'service-epsilon', 'service-zeta', 'service-eta', 'service-theta',
      'service-iota', 'service-kappa',
    ];
    baseValue = 5_000;
  }

  // Zipf-like decay: rank 0 has ~base, rank N has ~base/N
  const items = names.map((name, i) => ({
    name,
    value: Math.round(baseValue / Math.pow(i + 1, 0.7) * (0.85 + seededRand(seed, i) * 0.3)),
    ...(unit !== undefined ? { unit } : {}),
  }));
  return { items };
}

function mockServiceMap(widget: Widget): unknown {
  const seed = hashCode(widget.id);
  const nodes: { id: string; label: string; status?: string }[] = [
    { id: 'api', label: 'API Gateway', status: 'healthy' },
    { id: 'auth', label: 'auth-svc', status: seed % 5 === 0 ? 'degraded' : 'healthy' },
    { id: 'billing', label: 'billing', status: 'healthy' },
    { id: 'worker', label: 'worker', status: 'healthy' },
    { id: 'db', label: 'postgres', status: seed % 7 === 0 ? 'warn' : 'healthy' },
    { id: 'cache', label: 'valkey', status: 'healthy' },
  ];
  const edges = [
    { from: 'api', to: 'auth' },
    { from: 'api', to: 'billing' },
    { from: 'api', to: 'worker' },
    { from: 'auth', to: 'db' },
    { from: 'billing', to: 'db' },
    { from: 'worker', to: 'cache' },
    { from: 'worker', to: 'db' },
    { from: 'auth', to: 'cache' },
  ];
  return { nodes, edges };
}

function mockLogViewer(): unknown {
  const now = new Date();
  const levels: ('debug' | 'info' | 'warn' | 'error')[] = ['info', 'info', 'info', 'warn', 'info', 'error', 'info', 'debug', 'info', 'warn'];
  const messages = [
    'Request completed in 42ms — GET /api/v1/completions',
    'Rate limit applied to tenant acme (60 req/s)',
    'Auth token refreshed for user user-0004',
    'Upstream response slow: billing svc 890ms',
    'Plugin caddy-ratelimit loaded successfully',
    'Failed to connect to upstream billing:8080 — connection refused',
    'Caddy config reloaded — 0 errors',
    'Debug: cache miss for key session:abc123',
    'Webhook delivered to https://hooks.acme.example/notify',
    'Rate limit burst exceeded for api-key apikey-0001',
  ];
  const lines = messages.map((msg, i) => ({
    level: levels[i % levels.length] ?? 'info',
    ts: new Date(now.getTime() - i * 47_000).toISOString(),
    msg,
  }));
  return { lines };
}

function mockAuditTail(): unknown {
  const now = new Date();
  const entries = [
    { id: 'ae-m1', at: new Date(now.getTime() - 2 * 60_000).toISOString(), action: 'policy.update', actor_id: 'user-0001', outcome: 'success' },
    { id: 'ae-m2', at: new Date(now.getTime() - 8 * 60_000).toISOString(), action: 'api_key.revoke', actor_id: 'user-0003', outcome: 'success' },
    { id: 'ae-m3', at: new Date(now.getTime() - 15 * 60_000).toISOString(), action: 'route.delete', actor_id: 'user-0002', outcome: 'success' },
    { id: 'ae-m4', at: new Date(now.getTime() - 23 * 60_000).toISOString(), action: 'user.login', actor_id: 'unknown', outcome: 'denied' },
    { id: 'ae-m5', at: new Date(now.getTime() - 41 * 60_000).toISOString(), action: 'plugin.install', actor_id: 'user-0001', outcome: 'success' },
    { id: 'ae-m6', at: new Date(now.getTime() - 65 * 60_000).toISOString(), action: 'role.assign', actor_id: 'user-0004', outcome: 'success' },
    { id: 'ae-m7', at: new Date(now.getTime() - 90 * 60_000).toISOString(), action: 'config.export', actor_id: 'user-0002', outcome: 'denied' },
    { id: 'ae-m8', at: new Date(now.getTime() - 120 * 60_000).toISOString(), action: 'site.create', actor_id: 'user-0001', outcome: 'success' },
    { id: 'ae-m9', at: new Date(now.getTime() - 180 * 60_000).toISOString(), action: 'middleware.update', actor_id: 'user-0003', outcome: 'error' },
    { id: 'ae-m10', at: new Date(now.getTime() - 240 * 60_000).toISOString(), action: 'api_key.create', actor_id: 'user-0001', outcome: 'success' },
  ];
  return { entries };
}

function mockTable(widget: Widget): unknown {
  const seed = hashCode(widget.id);
  const title = widget.title.toLowerCase();

  if (title.includes('endpoint') || title.includes('slowest')) {
    const endpoints = [
      '/api/v1/completions', '/api/v1/embeddings', '/api/v1/fine-tunes',
      '/api/v1/images/generate', '/api/v1/audio/transcriptions',
      '/api/v1/assistants', '/api/v1/threads', '/api/v1/runs',
    ];
    const rows = endpoints.map((path, i) => ({
      endpoint: path,
      method: i % 3 === 0 ? 'GET' : 'POST',
      p95_ms: Math.round(80 + seededRand(seed, i) * 800),
      req_s: parseFloat((0.5 + seededRand(seed, i + 1) * 12).toFixed(1)),
      error_rate: `${(seededRand(seed, i + 2) * 3).toFixed(2)}%`,
    }));
    return { rows, columns: ['endpoint', 'method', 'p95_ms', 'req_s', 'error_rate'] };
  }

  if (title.includes('invoice') || title.includes('billing') || title.includes('history')) {
    const rows = Array.from({ length: 8 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      return {
        period: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
        amount: `$${(80 + seededRand(seed, i) * 220).toFixed(2)}`,
        status: i === 0 ? 'pending' : 'success',
        items: Math.round(3 + seededRand(seed, i + 10) * 8),
      };
    });
    return { rows, columns: ['period', 'amount', 'status', 'items'] };
  }

  if (title.includes('audit')) {
    const actions = ['policy.update', 'api_key.create', 'user.login', 'route.delete', 'plugin.install', 'role.assign'];
    const outcomes = ['success', 'success', 'success', 'denied', 'success', 'error'];
    const rows = Array.from({ length: 10 }, (_, i) => ({
      action: actions[i % actions.length],
      actor: `user-${String((i % 4) + 1).padStart(4, '0')}`,
      outcome: outcomes[i % outcomes.length],
      at: new Date(Date.now() - i * 3_600_000).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }),
    }));
    return { rows, columns: ['action', 'actor', 'outcome', 'at'] };
  }

  // Generic rows
  const rows = Array.from({ length: 10 }, (_, i) => ({
    name: `item-${String(i + 1).padStart(3, '0')}`,
    value: Math.round(100 + seededRand(seed, i) * 9900),
    status: seededRand(seed, i + 5) > 0.8 ? 'warning' : 'active',
    updated: new Date(Date.now() - i * 7_200_000).toLocaleDateString(),
  }));
  return { rows };
}

function mockSparkline(widget: Widget): unknown {
  const seed = hashCode(widget.id);
  const title = widget.title.toLowerCase();
  const COUNT = 48;
  const labels = hourlyLabels(COUNT);

  let base = 500;
  let amplitude = 200;
  let color = 'blue.5';

  if (title.includes('error')) { base = 12; amplitude = 8; color = 'red.5'; }
  else if (title.includes('latency')) { base = 80; amplitude = 30; color = 'orange.5'; }
  else if (title.includes('token')) { base = 4_000; amplitude = 1_500; color = 'violet.5'; }
  else if (title.includes('cost') || title.includes('spend')) { base = 8; amplitude = 3; color = 'yellow.5'; }
  else if (title.includes('session') || title.includes('active')) { base = 80; amplitude = 30; color = 'teal.5'; }

  const points = labels.map((x, i) => ({
    x,
    y: trendPoint(seed, i, base, amplitude, 24),
  }));
  return { points, color };
}

function mockAdapter(widget: Widget, state: MockStore): unknown {
  // When raw_query is set, fall back to the generic 20-row pipeline so that
  // raw_query filters, group_by, aggregate, and limit all work as expected.
  // This preserves the raw_query pipeline contract used in tests and the
  // builder's preview mode. The rich kind-specific generators are only used
  // for the default (no raw_query) display path.
  if (widget.raw_query.trim().length > 0) {
    const seed = hashCode(widget.id);
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push({ x: i, y: ((seed + i * 7919) % 100) + 1, label: `row-${String(i)}` });
    }
    const query = resolveQuery(widget, widgetVariables(widget, state));
    const filtered = applyFilters(rows, query.filters);
    return finalShape(widget, filtered, query);
  }

  switch (widget.kind) {
    case 'single-stat':  return mockSingleStat(widget);
    case 'sparkline':    return mockSparkline(widget);
    case 'time-series':  return mockTimeSeries(widget);
    case 'stacked-bar':  return mockStackedBar(widget);
    case 'pie':          return mockPie(widget);
    case 'top-n':        return mockTopN(widget);
    case 'service-map':  return mockServiceMap(widget);
    case 'log-viewer':   return mockLogViewer();
    case 'audit-tail':   return mockAuditTail();
    case 'table':        return mockTable(widget);
    default: {
      const seed = hashCode(widget.id);
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        rows.push({ x: i, y: ((seed + i * 7919) % 100) + 1, label: `row-${String(i)}` });
      }
      return { rows };
    }
  }
}

/**
 * Map raw filtered rows + query result into the shape each widget kind
 * expects. Consumers that need raw rows can ignore this and operate on
 * the array directly — `rows` is always returned under `.rows`.
 */
function finalShape(widget: Widget, rows: Record<string, unknown>[], query: NormalizedQuery): unknown {
  const { groups } = applyGroupAggregate(rows, query);
  const limitedRows = query.limit !== undefined ? rows.slice(0, query.limit) : rows;

  switch (widget.kind) {
    case 'single-stat': {
      const agg = query.aggregate;
      const value =
        agg !== undefined
          ? aggregate(rows.map((r) => asNumber(rowGet(r, agg.field))), agg.op)
          : rows.length;
      return { value };
    }
    case 'sparkline':
    case 'time-series': {
      const points = limitedRows.slice(0, 20).map((r, i) => ({
        x: asNumber(rowGet(r, 'x'), i),
        y: asNumber(rowGet(r, 'y'), i),
      }));
      return widget.kind === 'sparkline' ? { points } : { points, series: 'value' };
    }
    case 'stacked-bar': {
      const categories =
        groups.length > 0
          ? groups.map((g) => ({ label: g.key, value: g.value }))
          : limitedRows.map((r, i) => ({
              label: asString(rowGet(r, 'label'), `row-${String(i)}`),
              value: asNumber(rowGet(r, 'y')),
            }));
      return { categories, series: [{ name: 'value' }] };
    }
    case 'pie': {
      const slices =
        groups.length > 0
          ? groups.map((g) => ({ name: g.key, value: g.value }))
          : limitedRows.slice(0, 6).map((r, i) => ({
              name: asString(rowGet(r, 'label'), `row-${String(i)}`),
              value: asNumber(rowGet(r, 'y'), 1),
            }));
      return { slices };
    }
    case 'top-n': {
      const items =
        groups.length > 0
          ? groups.map((g) => ({ name: g.key, value: g.value }))
          : limitedRows.slice(0, query.limit ?? 10).map((r, i) => ({
              name: asString(rowGet(r, 'label'), `row-${String(i)}`),
              value: asNumber(rowGet(r, 'y')),
            }));
      return { items };
    }
    case 'table': {
      return { rows: limitedRows };
    }
    case 'log-viewer': {
      const lines = limitedRows.slice(0, 50).map((r) => {
        const level = rowGet(r, 'level');
        const normalizedLevel: 'debug' | 'info' | 'warn' | 'error' =
          level === 'debug' || level === 'warn' || level === 'error' ? level : 'info';
        return {
          level: normalizedLevel,
          ts: asString(rowGet(r, 'at') ?? rowGet(r, 'created_at')),
          msg: asString(rowGet(r, 'action') ?? rowGet(r, 'title') ?? rowGet(r, 'label'), 'event'),
        };
      });
      return { lines };
    }
    case 'audit-tail': {
      const entries = limitedRows.slice(0, 20).map((r) => ({
        id: asString(rowGet(r, 'id')),
        at: asString(rowGet(r, 'at')),
        action: asString(rowGet(r, 'action')),
        actor_id: asString(rowGet(r, 'actor_id')),
        outcome: asString(rowGet(r, 'outcome'), 'success'),
      }));
      return { entries };
    }
    case 'service-map': {
      const nodes = limitedRows.slice(0, 6).map((r, i) => ({
        id: asString(rowGet(r, 'id'), `n-${String(i)}`),
        label: asString(rowGet(r, 'name') ?? rowGet(r, 'label'), `svc-${String(i)}`),
      }));
      const edges: { from: string; to: string }[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        const from = nodes[i];
        const to = nodes[i + 1];
        if (from && to) edges.push({ from: from.id, to: to.id });
      }
      return { nodes, edges };
    }
    default:
      return { rows: limitedRows };
  }
}

export const DATA_SOURCE_ADAPTERS: Record<string, AdapterFn> = {
  audit: auditAdapter,
  services: servicesAdapter,
  routes: routesAdapter,
  traces: tracesAdapter,
  notifications: notificationsAdapter,
  mock: mockAdapter,
};

/**
 * Run a widget's query. Throws WidgetQueryError for unknown data sources or
 * invalid advanced queries.
 */
export function runWidgetQuery(widget: Widget, state: MockStore): unknown {
  const adapter = DATA_SOURCE_ADAPTERS[widget.data_source];
  if (!adapter) throw new WidgetQueryError(`Unknown data source: ${widget.data_source}`);
  return adapter(widget, state);
}
