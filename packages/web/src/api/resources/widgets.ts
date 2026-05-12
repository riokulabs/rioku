// Types for the widgets resource surface.

import type { ID } from './common';
import type { Dashboard } from './dashboards';

export interface WidgetWizardState {
  dimensions: string[];
  measures: {
    field: string;
    aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
    alias?: string;
  }[];
  filters: {
    field: string;
    op: '==' | '!=' | '>' | '<' | 'in' | 'contains';
    value: unknown;
  }[];
  group_by?: string;
  order_by?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

export interface Widget {
  readonly id: ID;
  readonly dashboard_id: ID;
  /** Widget type id — built-in (single-stat, sparkline, …) or plugin-registered. */
  kind: string;
  title: string;
  config: Record<string, unknown>;
  /**
   * Legacy grid position. Canonical layout source is `Dashboard.layout`.
   * TODO: remove once all builder paths migrate to `Dashboard.layout`.
   */
  position: { x: number; y: number; w: number; h: number };
  /**
   * Data-source kind — one of the 6 built-in sources or a plugin-declared id.
   *
   * Builtin values: `'audit' | 'services' | 'routes' | 'traces' | 'notifications' | 'mock'`.
   * Plugin adapters may register arbitrary string ids.
   */
  data_source: string;
  /** For advanced mode: raw query text. Empty = wizard-built. */
  raw_query: string;
  /** Wizard state — preserved when flipping to advanced (one-way for non-trivial widgets). */
  wizard_state?: WidgetWizardState;
  /** True when widget has been flipped to advanced and wizard view is disabled. */
  locked_advanced: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface DashboardVersion {
  readonly id: ID;
  readonly dashboard_id: ID;
  readonly version: number;
  readonly created_at: string;
  readonly created_by: ID;
  description?: string;
  snapshot: {
    dashboard: Omit<Dashboard, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>;
    widgets: Omit<Widget, 'dashboard_id' | 'created_at' | 'updated_at'>[];
  };
}
