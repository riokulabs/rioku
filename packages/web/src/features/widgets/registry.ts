/**
 * Built-in widget registry.
 *
 * The dashboard builder looks up a widget's visual component by its `kind`
 * here. Plugin-registered widgets live in `host.widgets`; both lookups are
 * surfaced by `<WidgetRendererDispatcher>`.
 */
import { SingleStatWidget } from './components/single-stat';
import { SparklineWidget } from './components/sparkline';
import { TimeSeriesWidget } from './components/time-series';
import { StackedBarWidget } from './components/stacked-bar';
import { TableWidget } from './components/table';
import { PieWidget } from './components/pie';
import { ServiceMapWidget } from './components/service-map';
import { LogViewerWidget } from './components/log-viewer';
import { AuditTailWidget } from './components/audit-tail';
import { TopNWidget } from './components/top-n';
import { KpiCardWidget } from './components/kpi-card';
import { GaugeWidget } from './components/gauge';
import { HeatmapWidget } from './components/heatmap';
import { AreaChartWidget } from './components/area-chart';
import { StatusGridWidget } from './components/status-grid';
import { BarChartWidget } from './components/bar-chart';
import { DonutWidget } from './components/donut';
import { FunnelWidget } from './components/funnel';
import { MarkdownWidget } from './components/markdown';
import { ProgressWidget } from './components/progress';
import type { WidgetTypeDefinition } from './types';

export const BUILT_IN_WIDGETS: Record<string, WidgetTypeDefinition> = {
  'single-stat': {
    type: 'single-stat',
    displayName: 'Single stat',
    description: 'One headline number plus optional delta.',
    defaultConfig: { unit: '' },
    supportedDataSources: 'any',
    roundTripMode: 'clean',
    component: SingleStatWidget,
  },
  sparkline: {
    type: 'sparkline',
    displayName: 'Sparkline',
    description: 'Tiny trend line over time.',
    defaultConfig: {},
    supportedDataSources: ['audit', 'traces', 'services', 'routes', 'mock'],
    roundTripMode: 'clean',
    component: SparklineWidget,
  },
  'time-series': {
    type: 'time-series',
    displayName: 'Time series',
    description: 'Line chart over time, single metric.',
    defaultConfig: {},
    supportedDataSources: ['audit', 'traces', 'services', 'routes', 'mock'],
    roundTripMode: 'clean',
    component: TimeSeriesWidget,
  },
  'stacked-bar': {
    type: 'stacked-bar',
    displayName: 'Stacked bar',
    description: 'Multi-series stacked bar chart.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'one-way',
    component: StackedBarWidget,
  },
  table: {
    type: 'table',
    displayName: 'Table',
    description: 'Tabular rows with inferred columns.',
    defaultConfig: { pageSize: 20 },
    supportedDataSources: 'any',
    roundTripMode: 'one-way',
    component: TableWidget,
  },
  pie: {
    type: 'pie',
    displayName: 'Pie',
    description: 'Categorical aggregation as a pie.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'one-way',
    component: PieWidget,
  },
  'service-map': {
    type: 'service-map',
    displayName: 'Service map',
    description: 'Node-link topology diagram.',
    defaultConfig: {},
    supportedDataSources: ['services', 'mock'],
    roundTripMode: 'one-way',
    component: ServiceMapWidget,
  },
  'log-viewer': {
    type: 'log-viewer',
    displayName: 'Log viewer',
    description: 'Recent log entries, color-coded by level.',
    defaultConfig: { maxLines: 100 },
    supportedDataSources: ['audit', 'notifications', 'mock'],
    roundTripMode: 'one-way',
    component: LogViewerWidget,
  },
  'audit-tail': {
    type: 'audit-tail',
    displayName: 'Audit tail',
    description: 'Recent audit entries, most-recent first.',
    defaultConfig: { limit: 20 },
    supportedDataSources: ['audit'],
    roundTripMode: 'one-way',
    component: AuditTailWidget,
  },
  'top-n': {
    type: 'top-n',
    displayName: 'Top N',
    description: 'Ranked list with proportional bars.',
    defaultConfig: { limit: 10 },
    supportedDataSources: 'any',
    roundTripMode: 'one-way',
    component: TopNWidget,
  },
  'kpi-card': {
    type: 'kpi-card',
    displayName: 'KPI card',
    description: 'Headline number, delta pill, and inline trend sparkline.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'clean',
    component: KpiCardWidget,
  },
  gauge: {
    type: 'gauge',
    displayName: 'Gauge',
    description: 'Semi-circular arc gauge with threshold-based colour.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'clean',
    component: GaugeWidget,
  },
  heatmap: {
    type: 'heatmap',
    displayName: 'Heatmap',
    description: '2D cell grid shaded by value intensity.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'one-way',
    component: HeatmapWidget,
  },
  'area-chart': {
    type: 'area-chart',
    displayName: 'Area chart',
    description: 'Multi-series area with gradient fills and legend.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'one-way',
    component: AreaChartWidget,
  },
  'status-grid': {
    type: 'status-grid',
    displayName: 'Status grid',
    description: 'Uniform grid of system-component health tiles.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'one-way',
    component: StatusGridWidget,
  },
  'bar-chart': {
    type: 'bar-chart',
    displayName: 'Bar chart',
    description: 'Single-series vertical bar chart.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'clean',
    component: BarChartWidget,
  },
  donut: {
    type: 'donut',
    displayName: 'Donut',
    description: 'Donut chart with a centered headline value.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'one-way',
    component: DonutWidget,
  },
  funnel: {
    type: 'funnel',
    displayName: 'Funnel',
    description: 'Conversion funnel with proportional stage segments.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'one-way',
    component: FunnelWidget,
  },
  markdown: {
    type: 'markdown',
    displayName: 'Markdown',
    description: 'Free-form text / markdown panel for annotations.',
    defaultConfig: { content: '## Notes\n\nUse this panel for context.' },
    supportedDataSources: 'any',
    roundTripMode: 'clean',
    component: MarkdownWidget,
  },
  progress: {
    type: 'progress',
    displayName: 'Progress',
    description: 'Linear progress bar — single or stacked goal indicators.',
    defaultConfig: {},
    supportedDataSources: 'any',
    roundTripMode: 'clean',
    component: ProgressWidget,
  },
};

/** Convenience: the list of built-in widget type ids. */
export const BUILT_IN_WIDGET_IDS: readonly string[] = Object.keys(BUILT_IN_WIDGETS);

/** Look up a built-in widget type definition by kind. Returns undefined if missing. */
export function getBuiltInWidget(kind: string): WidgetTypeDefinition | undefined {
  return BUILT_IN_WIDGETS[kind];
}
