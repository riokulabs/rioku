/**
 * Sidebar-entry registry — spec §9.5.3
 *
 * Plugins register sidebar nav entries grouped into one of four groups.
 * First-party sidebar (app-shell) reads this registry and renders plugin
 * entries below built-in entries in the same group.
 *
 * Duplicate-path policy: reject (same path in same group is a duplicate).
 * Multiple entries with the same path across different groups are allowed.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type React from 'react';
import { makeIdFactory } from '@/lib/id-generator';

const nextSidebarId = makeIdFactory('sidebar');

// ─── Types ────────────────────────────────────────────────────────────────────

export type SidebarGroup = 'general' | 'security' | 'system' | 'plugins';

export interface SidebarEntry {
  id: string;
  group: SidebarGroup;
  label: string;
  icon?: React.ComponentType;
  path: string;
  order?: number;
  source: 'first-party' | 'plugin';
  pluginName?: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface SidebarStore {
  entries: SidebarEntry[];
}

const useSidebarStore = create<SidebarStore>()(() => ({ entries: [] }));

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Register a sidebar entry. Returns the id for later unregistration.
 * Rejects duplicate (group + path) combinations — warns in dev.
 */
export function registerSidebarEntry(entry: Omit<SidebarEntry, 'id'>): string {
  const existing = useSidebarStore
    .getState()
    .entries.find((e) => e.group === entry.group && e.path === entry.path);
  if (existing) {
    if (import.meta.env.DEV) {
      console.warn(
        `[host.sidebar] Duplicate entry path "${entry.path}" in group "${entry.group}" — rejected. Existing id: ${existing.id}`,
      );
    }
    return existing.id;
  }
  const id = nextSidebarId();
  useSidebarStore.setState((state) => ({
    entries: [...state.entries, { ...entry, id }],
  }));
  return id;
}

/** Unregister a sidebar entry by id. No-op if not found. */
export function unregisterSidebarEntry(id: string): void {
  useSidebarStore.setState((state) => ({
    entries: state.entries.filter((e) => e.id !== id),
  }));
}

/**
 * Return sidebar entries for a specific group, sorted by `order` then label.
 * If no group is provided, returns all entries.
 */
export function listSidebarEntries(group?: SidebarGroup): SidebarEntry[] {
  const entries = useSidebarStore.getState().entries;
  const filtered = group ? entries.filter((e) => e.group === group) : entries;
  return filtered.slice().sort((a, b) => {
    const orderDiff = (a.order ?? 999) - (b.order ?? 999);
    return orderDiff !== 0 ? orderDiff : a.label.localeCompare(b.label);
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** React hook — re-renders when sidebar entries for the given group change. */
export function useSidebarEntries(group?: SidebarGroup): SidebarEntry[] {
  return useSidebarStore(
    useShallow((state) => {
      const filtered = group ? state.entries.filter((e) => e.group === group) : state.entries;
      return filtered.slice().sort((a, b) => {
        const orderDiff = (a.order ?? 999) - (b.order ?? 999);
        return orderDiff !== 0 ? orderDiff : a.label.localeCompare(b.label);
      });
    }),
  );
}
