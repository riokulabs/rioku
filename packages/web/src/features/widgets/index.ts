/**
 * Widgets feature — barrel exports.
 */
export { BUILT_IN_WIDGETS, BUILT_IN_WIDGET_IDS, getBuiltInWidget } from './registry';
export type { WidgetRenderProps, WidgetTypeDefinition } from './types';
export { WidgetRenderError } from './types';

export { DATA_SOURCE_ADAPTERS, WidgetQueryError, runWidgetQuery } from './data-sources';
export type { AdvancedQuery } from './data-sources';

export { SingleStatWidget } from './components/single-stat';
export { SparklineWidget } from './components/sparkline';
export { TimeSeriesWidget } from './components/time-series';
export { StackedBarWidget } from './components/stacked-bar';
export { TableWidget } from './components/table';
export { PieWidget } from './components/pie';
export { ServiceMapWidget } from './components/service-map';
export { LogViewerWidget } from './components/log-viewer';
export { AuditTailWidget } from './components/audit-tail';
export { TopNWidget } from './components/top-n';
