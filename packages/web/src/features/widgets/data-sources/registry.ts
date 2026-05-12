/**
 * Per-widget-kind data fetcher registry.
 *
 * Maps a widget's `dataSource` string to the function that fetches its data
 * from the daemon. Widgets carry their own `kind` (line-chart / bar /
 * single-stat / table) which determines how the renderer interprets the
 * result; the data source determines where the bytes come from.
 *
 * The only fully-wired source is `promql`; audit / notifications / traces
 * are stubbed pending wiring.
 */
import type { DaemonWidget } from '@/features/widgets/daemon-api';
import { fetchPromQLForRange, type PromQLResult } from './promql';

export interface WidgetDataState<T> {
  loading: boolean;
  data: T | undefined;
  error: Error | undefined;
}

export interface WidgetDataRange {
  start: string;
  end: string;
  step: string;
}

export type WidgetDataResult = PromQLResult | { rows: Record<string, unknown>[] };

/**
 * Resolve which fetcher to use for the widget. Returns `undefined`
 * if the data source is unknown (caller renders an empty state).
 */
export function dataSourceFor(widget: DaemonWidget): string {
  const ds = widget.dataSource;
  if (typeof ds === 'string' && ds.length > 0) return ds;
  // Fall back to inspecting the widget config — pre-stage-2 widgets
  // sometimes encoded the source there.
  const cfg = widget.config as Record<string, unknown>;
  const fromCfg = cfg.dataSource ?? cfg.data_source;
  return typeof fromCfg === 'string' ? fromCfg : 'promql';
}

/**
 * Top-level dispatch: given a widget + tenant + optional range,
 * fetch its data. Renderers consume the discriminated `WidgetDataResult`.
 *
 * Throws on unknown data sources rather than returning `undefined` so
 * mis-configured widgets surface loud errors instead of silent blanks.
 */
export async function fetchWidgetData(
  tenant: string,
  widget: DaemonWidget,
  range?: WidgetDataRange,
): Promise<WidgetDataResult> {
  const source = dataSourceFor(widget);
  switch (source) {
    case 'promql': {
      const cfg = widget.config as Record<string, unknown>;
      const queryRaw = widget.rawQuery ?? cfg.query;
      const query = typeof queryRaw === 'string' ? queryRaw : '';
      if (!query) {
        throw new Error(`Widget ${widget.id} has no PromQL query configured`);
      }
      return fetchPromQLForRange(tenant, query, range);
    }
    case 'audit':
    case 'notifications':
    case 'traces':
      // TODO: wire these data sources. Returning an empty rows result
      // keeps the renderer alive without lying about data.
      return { rows: [] };
    default:
      throw new Error(`Unknown widget data source: ${source}`);
  }
}
