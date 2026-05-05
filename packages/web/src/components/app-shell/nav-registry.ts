/**
 * nav-registry — module-singleton registry for feature-contributed sidebar
 * leaf entries.
 *
 * Usage:
 *   // In a feature's nav.ts:
 *   import { registerNavEntries } from '@/components/app-shell/nav-registry';
 *   registerNavEntries({ id: 'services', label: 'Services', ... });
 *
 *   // In the sidebar renderer:
 *   import { getNavEntries } from '@/components/app-shell/nav-registry';
 *   const entries = getNavEntries().filter(e => e.group === 'apim');
 */
import type { ComponentType } from 'react';

export type NavGroup = 'dashboard' | 'sites' | 'analytics' | 'apim' | 'ai' | 'security' | 'system';

export interface NavEntry {
  /** Stable unique id, used for last-write-wins deduplication. */
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Path suffix after `/t/$tenant/` (e.g. "services", "ai/providers"). */
  suffix: string;
  /** Which rail section this entry belongs to. */
  group: NavGroup;
  /** Within-group ordering; lower numbers render first. */
  order: number;
  requirePermission?: string;
}

const _entries: NavEntry[] = [];

/**
 * Register one or more nav entries. If an entry with the same `id` already
 * exists it is replaced (last-write-wins), so feature variants can override
 * defaults without creating duplicates.
 */
export function registerNavEntries(...newEntries: NavEntry[]): void {
  for (const e of newEntries) {
    const idx = _entries.findIndex((x) => x.id === e.id);
    if (idx === -1) _entries.push(e);
    else _entries[idx] = e;
  }
}

/** Returns a sorted snapshot of all registered entries. */
export function getNavEntries(): NavEntry[] {
  return _entries.slice().sort((a, b) => {
    if (a.group !== b.group) return 0; // group ordering is done by the caller
    return a.order - b.order;
  });
}

/**
 * Returns all entries that belong to a given group, sorted by `order`.
 */
export function getNavEntriesForGroup(group: NavGroup): NavEntry[] {
  return _entries
    .filter((e) => e.group === group)
    .sort((a, b) => a.order - b.order);
}

/**
 * Reset the registry to empty. Intended for use in unit tests only.
 * @internal
 */
export function _resetNavRegistry(): void {
  _entries.length = 0;
}
