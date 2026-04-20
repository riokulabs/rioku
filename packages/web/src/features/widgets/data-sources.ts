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

function mockAdapter(widget: Widget, state: MockStore): unknown {
  const seed = hashCode(widget.id);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 20; i++) {
    rows.push({
      x: i,
      y: ((seed + i * 7919) % 100) + 1,
      label: `row-${String(i)}`,
    });
  }
  const query = resolveQuery(widget, widgetVariables(widget, state));
  const filtered = applyFilters(rows, query.filters);
  return finalShape(widget, filtered, query);
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
