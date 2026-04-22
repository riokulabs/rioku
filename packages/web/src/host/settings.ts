/**
 * Settings-panel registry — spec §9.5.4
 *
 * Plugins register settings panels that are injected into the global Settings
 * page (Task 1f.109+). First-party code reads panels grouped by section.
 *
 * Duplicate-id policy: reject (panel ids must be unique across sections).
 */

import { create } from 'zustand';
import type React from 'react';
import { makeIdFactory } from '@/lib/id-generator';

const nextSettingsId = makeIdFactory('settings');

// ─── Types ────────────────────────────────────────────────────────────────────

export type SettingsScope = 'global' | 'tenant' | 'both';

export interface SettingsPanel {
  id: string;
  section: string;
  component: React.ComponentType;
  scope: SettingsScope;
  order?: number;
  source: 'first-party' | 'plugin';
  pluginName?: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface SettingsStore {
  panels: SettingsPanel[];
}

const useSettingsStore = create<SettingsStore>()(() => ({ panels: [] }));

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Register a settings panel. Returns the id for later unregistration.
 * Rejects duplicate section + component combinations via generated id check.
 */
export function registerSettingsPanel(panel: Omit<SettingsPanel, 'id'>): string {
  const id = nextSettingsId();
  useSettingsStore.setState((state) => ({
    panels: [...state.panels, { ...panel, id }],
  }));
  return id;
}

/** Unregister a settings panel by id. No-op if not found. */
export function unregisterSettingsPanel(id: string): void {
  useSettingsStore.setState((state) => ({
    panels: state.panels.filter((p) => p.id !== id),
  }));
}

/**
 * Return settings panels, optionally filtered to a section.
 * Results sorted by `order` then source (first-party first).
 */
export function listSettingsPanels(section?: string): SettingsPanel[] {
  const panels = useSettingsStore.getState().panels;
  const filtered = section ? panels.filter((p) => p.section === section) : panels;
  return filtered.slice().sort((a, b) => {
    const orderDiff = (a.order ?? 999) - (b.order ?? 999);
    if (orderDiff !== 0) return orderDiff;
    // first-party before plugin
    if (a.source !== b.source) return a.source === 'first-party' ? -1 : 1;
    return 0;
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** React hook — re-renders when settings panels change. */
export function useSettingsPanels(section?: string): SettingsPanel[] {
  return useSettingsStore((state) => {
    const filtered = section ? state.panels.filter((p) => p.section === section) : state.panels;
    return filtered.slice().sort((a, b) => {
      const orderDiff = (a.order ?? 999) - (b.order ?? 999);
      if (orderDiff !== 0) return orderDiff;
      if (a.source !== b.source) return a.source === 'first-party' ? -1 : 1;
      return 0;
    });
  });
}
