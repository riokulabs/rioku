/**
 * Dashboard-widget registry — spec §9.5.8
 *
 * Plugins register widget types. The dashboard builder reads this registry
 * to offer the full set of available widget types when a user adds a widget.
 *
 * Duplicate-type policy: overwrite with a warning in dev (same natural key).
 */

import { create } from 'zustand';
import type React from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WidgetRegistration {
  type: string;
  displayName: string;
  /** JSON-schema shapes for input and config (unknown at stage-1). */
  schema: {
    input: unknown;
    config: unknown;
  };
  component: React.ComponentType<{ data: unknown; config: unknown }>;
  source: 'first-party' | 'plugin';
  pluginName?: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface WidgetStore {
  widgets: WidgetRegistration[];
}

const useWidgetStore = create<WidgetStore>()(() => ({ widgets: [] }));

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Register a widget type. Uses `type` as the natural key.
 * Overwrites existing registration with the same type (warns in dev).
 */
export function registerWidget(widget: WidgetRegistration): void {
  useWidgetStore.setState((state) => {
    const existing = state.widgets.find((w) => w.type === widget.type);
    if (existing && import.meta.env.DEV) {
      console.warn(`[host.widgets] Widget type "${widget.type}" already registered — overwriting.`);
    }
    const widgets = existing
      ? state.widgets.map((w) => (w.type === widget.type ? widget : w))
      : [...state.widgets, widget];
    return { widgets };
  });
}

/** Unregister a widget type by its type string. No-op if not found. */
export function unregisterWidget(type: string): void {
  useWidgetStore.setState((state) => ({
    widgets: state.widgets.filter((w) => w.type !== type),
  }));
}

/** Return all registered widget types. */
export function listWidgets(): WidgetRegistration[] {
  return useWidgetStore.getState().widgets;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** React hook — re-renders when widget registrations change. */
export function useWidgets(): WidgetRegistration[] {
  return useWidgetStore((state) => state.widgets);
}
