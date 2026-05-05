/**
 * Widget feature-local types.
 *
 * The Plan 4 widget registry exposes 10 built-in widget definitions. Each
 * definition pairs a visual component with metadata (supported data sources,
 * round-trip mode) used by the dashboard builder.
 */
import type { ComponentType } from 'react';
import type { Widget } from '@/api/resources';

/** Shape passed into every widget component. */
export interface WidgetRenderProps {
  /** The widget configuration record. */
  widget: Widget;
  /** Result of `runWidgetQuery` for this widget. Shape is per-widget-kind. */
  data: unknown;
  /** True while the query is still resolving. */
  loading: boolean;
  /** Populated when the query errored. */
  error?: string;
}

/**
 * Describes a built-in widget type. Plugin widgets register independently
 * via `host.widgets.register` but conform to the same component contract.
 */
export interface WidgetTypeDefinition {
  /** Canonical id, e.g. `single-stat`. */
  type: string;
  displayName: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  /** Supported data-source kinds. `'any'` = works with any source. */
  supportedDataSources: readonly string[] | 'any';
  /**
   * Wizard round-trip semantics.
   *
   *   - `'clean'`     = Grafana → Metabase round-trip works; flipping back is safe.
   *   - `'one-way'`   = once flipped to advanced, wizard view is permanently disabled.
   */
  roundTripMode: 'clean' | 'one-way';
  /**
   * Suggested grid size when added from the palette. Falls back to a
   * 4×3 cell when omitted. The grid still enforces global MIN/MAX clamps.
   */
  defaultSize?: { w: number; h: number };
  /**
   * Minimum grid size below which the widget's content stops rendering
   * usefully. Non-binding (the user can still resize smaller) — used by
   * the renderer to switch to a compact layout if available.
   */
  minSize?: { w: number; h: number };
  component: ComponentType<WidgetRenderProps>;
}

/** Error thrown when a widget component receives data in the wrong shape. */
export class WidgetRenderError extends Error {
  readonly code = 'WIDGET_RENDER_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'WidgetRenderError';
  }
}
