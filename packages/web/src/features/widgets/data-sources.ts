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
import { getTimeRange, type TimeRange, type TimeRangeId } from '@/hooks/use-dashboard-range';

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
export function substituteVariables(raw: string, variables: readonly DashboardVariable[]): string {
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
        typeof v === 'string' &&
        typeof f.value === 'string' &&
        v.toLowerCase().includes(f.value.toLowerCase())
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

function aggregate(values: number[], op: NonNullable<AdvancedQuery['aggregate']>['op']): number {
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

/**
 * Return the first numeric field value found in a row (skipping common id/date
 * fields). Used as a fallback when rows from real data sources lack a `y` field.
 */
const SKIP_NUMERIC_FIELDS = new Set(['x', 'position', 'port', 'timeout', 'refresh_interval']);
function firstNumericValue(row: Record<string, unknown>): number {
  for (const [k, v] of Object.entries(row)) {
    if (SKIP_NUMERIC_FIELDS.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

/**
 * Best-effort string label from a row — tries common label fields before
 * falling back to index.
 */
function firstLabelValue(row: Record<string, unknown>, fallback: string): string {
  for (const field of ['name', 'title', 'label', 'id', 'action', 'path', 'host']) {
    const v = rowGet(row, field);
    if (typeof v === 'string' && v.length > 0) return v;
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
  if (query.group_by === undefined || query.aggregate === undefined)
    return { groups: [], raw: rows };

  const bucket = new Map<string, number[]>();
  for (const row of rows) {
    const key = asString(rowGet(row, query.group_by), 'unknown');
    const n = asNumber(rowGet(row, query.aggregate.field));
    const arr = bucket.get(key) ?? [];
    arr.push(n);
    bucket.set(key, arr);
  }
  let groups: { key: string; value: number }[] = [];
  for (const [k, vs] of bucket.entries())
    groups.push({ key: k, value: aggregate(vs, query.aggregate.op) });

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

function tenantFilter<T extends { tenant_id?: string | null }>(
  rows: T[],
  tenantId: string | null,
): T[] {
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

/**
 * Resolve the active dashboard time range from `widget.config._range`
 * (written by `useWidgetData`). Returns undefined when no provider is
 * active (e.g. unit tests, builder preview) so callers can fall back to
 * their pre-range defaults instead of silently swapping point counts.
 */
function rangeFromConfig(widget: Widget): TimeRange | undefined {
  const r = widget.config._range;
  if (typeof r === 'string') return getTimeRange(r as TimeRangeId);
  if (r && typeof r === 'object' && 'seconds' in r && 'points' in r) {
    return r as TimeRange;
  }
  return undefined;
}

// ─── Rich mock-data generators (kind-aware) ───────────────────────────────────

/**
 * Sinusoidal + seeded noise for time-series / sparkline points, sized to
 * the active dashboard range. Longer windows get more points and wider
 * x-axis tick labels (e.g. date for 7d+, HH:00 for 24h, minutes-ago for 1h).
 *
 * When no range is provided (range=undefined), falls back to hour-bucket
 * labels over the last N hours — preserves the pre-range-selector behavior
 * for callers outside a DashboardViewer (tests, builder preview).
 */
function mockTimePoints(
  seed: number,
  range: TimeRange | undefined,
  count: number,
): { x: string; y: number }[] {
  const base = 40 + (seed % 60);
  const amp = 15 + (seed % 25);
  const points: { x: string; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const noise = ((seed * (i + 1) * 6271) % 21) - 10;
    const y = Math.max(1, Math.round(base + amp * Math.sin((i / count) * Math.PI * 2) + noise));
    const label =
      range !== undefined
        ? range.formatTick(i, count)
        : (() => {
            const d = new Date(Date.now() - (count - i) * 60 * 60 * 1000);
            return `${d.getHours().toString().padStart(2, '0')}:00`;
          })();
    points.push({ x: label, y });
  }
  return points;
}

const MOCK_ENDPOINTS = [
  '/api/v1/users',
  '/api/v1/sessions',
  '/api/v1/tokens',
  '/api/v1/routes',
  '/api/v1/services',
  '/api/v1/audit',
  '/api/v1/traces',
  '/api/v1/plugins',
  '/api/v1/keys',
  '/api/v1/agents',
];

const MOCK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MOCK_SERVICE_NODES = [
  { id: 'gateway', label: 'gateway' },
  { id: 'api', label: 'api' },
  { id: 'auth', label: 'auth' },
  { id: 'billing', label: 'billing' },
  { id: 'worker', label: 'worker' },
  { id: 'postgres', label: 'postgres' },
  { id: 'valkey', label: 'valkey' },
];

const MOCK_SERVICE_EDGES = [
  { from: 'gateway', to: 'api' },
  { from: 'api', to: 'auth' },
  { from: 'api', to: 'billing' },
  { from: 'api', to: 'worker' },
  { from: 'api', to: 'postgres' },
  { from: 'worker', to: 'valkey' },
];

/**
 * Kind-aware mock adapter — returns realistic stub data shaped for each widget
 * kind so charts render with visible bars/lines/slices rather than zero values.
 */
function mockAdapter(widget: Widget, state: MockStore): unknown {
  const seed = hashCode(widget.id);
  const range = rangeFromConfig(widget);

  const query = resolveQuery(widget, widgetVariables(widget, state));

  switch (widget.kind) {
    case 'sparkline': {
      const count = query.limit ?? (range !== undefined ? Math.min(range.points, 30) : 20);
      return { points: mockTimePoints(seed, range, count) };
    }

    case 'time-series': {
      const count = query.limit ?? (range !== undefined ? range.points : 24);
      return { points: mockTimePoints(seed, range, count), series: 'req/s' };
    }

    case 'stacked-bar': {
      const categories = MOCK_DAYS.map((day, i) => {
        const base = 200 + ((seed + i * 1301) % 600);
        const success = Math.round(base * (0.75 + ((seed + i * 97) % 15) / 100));
        const client = Math.round(base * (0.12 + ((seed + i * 53) % 8) / 100));
        const server = Math.round(base * (0.04 + ((seed + i * 37) % 5) / 100));
        return { label: day, success, 'client-error': client, 'server-error': server };
      });
      // Use bare color names (no explicit shade) so Mantine's primaryShade
      // mechanism picks the correct shade for the active color scheme.
      // "green.6" is near-invisible against a dark card background; "green"
      // lets the theme resolve to a lighter shade in dark mode automatically.
      return {
        categories,
        series: [
          { name: 'success', color: 'green' },
          { name: 'client-error', color: 'yellow' },
          { name: 'server-error', color: 'red' },
        ],
      };
    }

    case 'pie': {
      // `config.slices` lets the seed override the default slice set (e.g.
      // HTTP methods, status classes, provider split). Without it we
      // synthesise a generic status-code breakdown.
      const cfg = widget.config;
      if (Array.isArray(cfg.slices)) {
        const provided = cfg.slices as { name: string; color?: string; base?: number }[];
        return {
          slices: provided.map((s, i) => ({
            name: s.name,
            // Apply small seeded jitter so the pie doesn't look hand-tuned.
            value: Math.max(1, (s.base ?? 50 - i * 7) + ((seed + i * 137) % 10) - 5),
            ...(s.color !== undefined ? { color: s.color } : {}),
          })),
        };
      }
      return {
        slices: [
          { name: 'Success', value: 78 + ((seed % 10) - 5), color: 'riokuSuccess' },
          { name: 'Error 4xx', value: 12 + ((seed % 6) - 3), color: 'riokuWarning' },
          { name: 'Error 5xx', value: 6 + ((seed % 4) - 2), color: 'riokuDanger' },
          { name: 'Timeout', value: 4 + ((seed % 3) - 1), color: 'riokuOrange' },
        ],
      };
    }

    case 'top-n': {
      const zipf = [1247, 891, 612, 432, 287, 198, 143, 97, 64, 41];
      const limit = query.limit ?? 10;
      const items = MOCK_ENDPOINTS.slice(0, limit).map((ep, i) => ({
        name: ep,
        value: Math.round((zipf[i] ?? 20) * (0.8 + ((seed + i * 127) % 40) / 100)),
      }));
      return { items };
    }

    case 'service-map':
      return { nodes: MOCK_SERVICE_NODES, edges: MOCK_SERVICE_EDGES };

    case 'kpi-card': {
      // `config.accent`, `config.unit`, `config.subtitle`, `config.valueSeed`
      // let the seed tailor each KPI card. We pull them so the same widget
      // kind can render "1.2M req/24h" and "42ms p95" from different configs.
      const cfg = widget.config;
      const accent = typeof cfg.accent === 'string' ? cfg.accent : 'riokuOrange';
      const unit = typeof cfg.unit === 'string' ? cfg.unit : undefined;
      const subtitle = typeof cfg.subtitle === 'string' ? cfg.subtitle : undefined;
      const valueBase = typeof cfg.valueBase === 'number' ? cfg.valueBase : 1200;
      const valueSpread = typeof cfg.valueSpread === 'number' ? cfg.valueSpread : 400;
      const deltaBase = typeof cfg.deltaBase === 'number' ? cfg.deltaBase : 0;
      const inverseDelta = cfg.inverseDelta === true;
      const value = valueBase + (seed % valueSpread) - valueSpread / 2;
      const delta = deltaBase + ((seed % 17) - 8) * 0.5;
      // Sparkline trend sized to the active range. Longer windows get more
      // points so the line has more articulation, not just a stretched
      // 24-point sample. Falls back to 24 when no range context is active.
      const trendPoints = range !== undefined ? Math.min(range.points, 60) : 24;
      const trend: number[] = [];
      for (let i = 0; i < trendPoints; i++) {
        const wiggle = ((seed + i * 7919) % 40) - 20;
        trend.push(Math.max(1, valueBase / 24 + wiggle));
      }
      return {
        value: Math.round(value),
        unit,
        subtitle,
        delta: Math.round(delta * 10) / 10,
        trend,
        accent,
        inverseDelta,
      };
    }

    case 'gauge': {
      const cfg = widget.config;
      const max = typeof cfg.max === 'number' ? cfg.max : 100;
      const suffix = typeof cfg.suffix === 'string' ? cfg.suffix : '%';
      const label = typeof cfg.label === 'string' ? cfg.label : undefined;
      const target = typeof cfg.target === 'number' ? cfg.target : max * 0.75;
      const jitter = (seed % 15) - 7;
      const value = Math.max(0, Math.min(max, target + jitter));
      const inverse = cfg.inverse === true;
      // Thresholds:
      //   - Non-inverse (higher = worse, e.g. CPU %): amber at 70% max,
      //     red at 90% max.
      //   - Inverse (lower = worse, e.g. uptime %): amber under 95% max,
      //     red under 80% max.
      const thresholds = inverse
        ? { warn: max * 0.95, crit: max * 0.8 }
        : { warn: max * 0.7, crit: max * 0.9 };
      return {
        value: Math.round(value * 10) / 10,
        max,
        suffix,
        label,
        thresholds,
        inverse,
      };
    }

    case 'heatmap': {
      const cfg = widget.config;
      const accent = typeof cfg.accent === 'string' ? cfg.accent : 'riokuOrange';
      const unit = typeof cfg.unit === 'string' ? cfg.unit : 'req/min';
      const xLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`);
      const yLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const cells: number[][] = [];
      for (let y = 0; y < yLabels.length; y++) {
        const row: number[] = [];
        const weekendDampen = y >= 5 ? 0.4 : 1.0;
        for (let x = 0; x < xLabels.length; x++) {
          // Typical "business hours" pattern: low at night, peak 10–16.
          const hourBias = Math.exp(-0.02 * Math.pow(x - 13, 2));
          const noise = ((seed + x * 101 + y * 997) % 23) / 23;
          row.push(Math.round((hourBias * 400 + noise * 120) * weekendDampen));
        }
        cells.push(row);
      }
      return { xLabels, yLabels, cells, accent, unit };
    }

    case 'area-chart': {
      const cfg = widget.config;
      const rawSeries =
        Array.isArray(cfg.series) && (cfg.series as unknown[]).length > 0
          ? (cfg.series as { name: string; color?: string }[])
          : [{ name: '2xx', color: 'riokuSuccess' }];
      const stacked = cfg.stacked === true;
      const totalPoints = range !== undefined ? range.points : 24;
      const points: Record<string, string | number>[] = [];
      for (let i = 0; i < totalPoints; i++) {
        const label =
          range !== undefined
            ? range.formatTick(i, totalPoints)
            : (() => {
                const d = new Date(Date.now() - (totalPoints - i) * 60 * 60 * 1000);
                return `${d.getHours().toString().padStart(2, '0')}:00`;
              })();
        const rec: Record<string, string | number> = {
          x: label,
        };
        rawSeries.forEach((s, si) => {
          const base = 60 - si * 15 + (seed % 25);
          const amp = 18 + ((seed + si * 53) % 12);
          const noise = ((seed + i * 6271 + si * 137) % 21) - 10;
          const y = Math.max(
            1,
            Math.round(base + amp * Math.sin((i / totalPoints) * Math.PI * 2) + noise),
          );
          rec[s.name] = y;
        });
        points.push(rec);
      }
      return { points, series: rawSeries, stacked };
    }

    case 'status-grid': {
      const cfg = widget.config;
      const defaultTiles = [
        { name: 'Daemon', status: 'ok', value: 'v0.2.0' },
        { name: 'Caddy', status: 'ok', value: 'v2.8.4' },
        { name: 'Postgres', status: 'ok', value: '3.2 GB' },
        { name: 'Valkey', status: 'ok', value: '112 MB' },
        { name: 'Cluster', status: 'ok', value: '3/3 nodes' },
        { name: 'gRPC', status: 'ok', value: ':7777' },
        { name: 'REST', status: 'ok', value: ':7778' },
        { name: 'Plugins', status: 'warn', value: '1 outdated' },
      ];
      const tiles = Array.isArray(cfg.tiles)
        ? (cfg.tiles as {
            name: string;
            status: 'ok' | 'warn' | 'error' | 'unknown';
            value?: string;
          }[])
        : defaultTiles;
      return { tiles };
    }

    case 'bar-chart': {
      const cfg = widget.config;
      if (Array.isArray(cfg.bars)) {
        const provided = cfg.bars as { name: string; color?: string; base?: number }[];
        return {
          bars: provided.map((b, i) => ({
            name: b.name,
            value: Math.max(1, (b.base ?? 50 - i * 6) + ((seed + i * 137) % 20) - 10),
            ...(b.color !== undefined ? { color: b.color } : {}),
          })),
        };
      }
      // Default: 7 weekday request totals.
      return {
        bars: MOCK_DAYS.map((day, i) => ({
          name: day,
          value: 200 + ((seed + i * 1301) % 600),
        })),
      };
    }

    case 'donut': {
      const cfg = widget.config;
      const baseSlices = Array.isArray(cfg.slices)
        ? (cfg.slices as { name: string; color?: string; base?: number }[])
        : [
            { name: 'Success', color: 'riokuSuccess', base: 78 },
            { name: '4xx', color: 'riokuWarning', base: 12 },
            { name: '5xx', color: 'riokuDanger', base: 6 },
            { name: 'Other', color: 'riokuOrange', base: 4 },
          ];
      const slices = baseSlices.map((s, i) => ({
        name: s.name,
        value: Math.max(1, (s.base ?? 25) + ((seed + i * 137) % 10) - 5),
        ...(s.color !== undefined ? { color: s.color } : {}),
      }));
      const total = slices.reduce((acc, s) => acc + s.value, 0);
      const centerLabel = typeof cfg.centerLabel === 'string' ? cfg.centerLabel : 'Total';
      const centerValue =
        typeof cfg.centerValue === 'string' || typeof cfg.centerValue === 'number'
          ? cfg.centerValue
          : total.toLocaleString();
      return { slices, centerValue, centerLabel };
    }

    case 'funnel': {
      const cfg = widget.config;
      if (Array.isArray(cfg.stages)) {
        const provided = cfg.stages as { name: string; color?: string; base?: number }[];
        let prev = provided[0]?.base ?? 1000;
        return {
          stages: provided.map((s, i) => {
            const value = i === 0 ? prev : Math.round(prev * (0.6 + ((seed + i * 53) % 30) / 100));
            prev = value;
            return {
              name: s.name,
              value,
              ...(s.color !== undefined ? { color: s.color } : {}),
            };
          }),
        };
      }
      // Default: classic acquisition funnel.
      const totalVisitors = 12000 + (seed % 3000);
      const signups = Math.round(totalVisitors * 0.42);
      const verified = Math.round(signups * 0.78);
      const trial = Math.round(verified * 0.55);
      const paid = Math.round(trial * 0.32);
      return {
        stages: [
          { name: 'Visitors', value: totalVisitors, color: 'riokuOrange' },
          { name: 'Sign-ups', value: signups, color: 'riokuInfo' },
          { name: 'Verified', value: verified, color: 'riokuInfo' },
          { name: 'Started trial', value: trial, color: 'riokuSuccess' },
          { name: 'Paid', value: paid, color: 'riokuSuccess' },
        ],
      };
    }

    case 'markdown': {
      // Markdown is config-driven — content lives in widget.config.content.
      // Adapter just passes it through so the renderer reads from data.
      const content =
        typeof widget.config.content === 'string'
          ? widget.config.content
          : '## Notes\n\nUse this panel for context.';
      return { content };
    }

    case 'progress': {
      const cfg = widget.config;
      if (Array.isArray(cfg.items)) {
        const provided = cfg.items as {
          name: string;
          base?: number;
          max?: number;
          color?: string;
        }[];
        return {
          items: provided.map((it, i) => ({
            name: it.name,
            value: Math.max(0, (it.base ?? 50) + ((seed + i * 89) % 30) - 15),
            max: it.max ?? 100,
            ...(it.color !== undefined ? { color: it.color } : {}),
          })),
        };
      }
      // Default single-bar — quota / utilization style.
      const max = typeof cfg.max === 'number' ? cfg.max : 100;
      const valueBase = typeof cfg.valueBase === 'number' ? cfg.valueBase : 73;
      const value = Math.max(0, Math.min(max, valueBase + ((seed % 20) - 10)));
      const label = typeof cfg.label === 'string' ? cfg.label : widget.title;
      const unit = typeof cfg.unit === 'string' ? cfg.unit : '';
      return { value, max, label, unit };
    }

    default: {
      // Generic rows for single-stat, table, log-viewer, audit-tail
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        rows.push({
          x: i,
          y: ((seed + i * 7919) % 100) + 1,
          label: `row-${String(i)}`,
        });
      }
      const filtered = applyFilters(rows, query.filters);
      return finalShape(widget, filtered, query);
    }
  }
}

/**
 * Map raw filtered rows + query result into the shape each widget kind
 * expects. Consumers that need raw rows can ignore this and operate on
 * the array directly — `rows` is always returned under `.rows`.
 */
function finalShape(
  widget: Widget,
  rows: Record<string, unknown>[],
  query: NormalizedQuery,
): unknown {
  const { groups } = applyGroupAggregate(rows, query);
  const limitedRows = query.limit !== undefined ? rows.slice(0, query.limit) : rows;

  switch (widget.kind) {
    case 'single-stat': {
      const agg = query.aggregate;
      const value =
        agg !== undefined
          ? aggregate(
              rows.map((r) => asNumber(rowGet(r, agg.field))),
              agg.op,
            )
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
          : limitedRows.map((r, i) => {
              const y = asNumber(rowGet(r, 'y'), -1);
              const value = y >= 0 ? y : firstNumericValue(r);
              return {
                label: firstLabelValue(r, `row-${String(i)}`),
                value,
              };
            });
      return { categories, series: [{ name: 'value' }] };
    }
    case 'pie': {
      const rawSlices =
        groups.length > 0
          ? groups.map((g) => ({ name: g.key, value: g.value }))
          : limitedRows.slice(0, 6).map((r, i) => {
              const y = asNumber(rowGet(r, 'y'), -1);
              const value = y >= 0 ? y : firstNumericValue(r);
              return {
                name: firstLabelValue(r, `row-${String(i)}`),
                value,
              };
            });
      // Guard: if all values are 0, distribute evenly so the pie is visible.
      // Recharts renders nothing when all data values are 0.
      const allZero = rawSlices.length > 0 && rawSlices.every((s) => s.value === 0);
      const slices = allZero ? rawSlices.map((s) => ({ ...s, value: 1 })) : rawSlices;
      return { slices };
    }
    case 'top-n': {
      const rawItems =
        groups.length > 0
          ? groups.map((g) => ({ name: g.key, value: g.value }))
          : limitedRows.slice(0, query.limit ?? 10).map((r, i) => {
              const y = asNumber(rowGet(r, 'y'), -1);
              const value = y >= 0 ? y : firstNumericValue(r);
              return {
                name: firstLabelValue(r, `row-${String(i)}`),
                value,
              };
            });
      // If all values are 0 (e.g. rows from a data source with no numeric
      // metrics), synthesise Zipf-distributed counts so the widget looks
      // meaningful rather than an all-zero ranking.
      const allZero = rawItems.every((it) => it.value === 0);
      const zipfBase = [1247, 891, 612, 432, 287, 198, 143, 97, 64, 41];
      const items = allZero
        ? rawItems.map((it, i) => ({
            name: it.name,
            value: zipfBase[i] ?? Math.max(1, 30 - i * 3),
          }))
        : rawItems;
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
