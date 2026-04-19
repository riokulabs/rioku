/**
 * Injection-zone registry — spec §9.5.1
 *
 * Tracks React component contributions keyed by zone string.
 * First-party `<Zone id="...">` components read from here to discover and
 * render contributions.
 *
 * Duplicate-zone policy: same (zone, component) pair is allowed.
 * Multiple plugins may contribute to the same zone — they are stacked in
 * registration order.
 */

import { create } from 'zustand';
import type React from 'react';
import { makeIdFactory } from '@/lib/id-generator';

const nextZoneId = makeIdFactory('zone');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZoneContribution {
  id: string;
  zone: string;
  component: React.ComponentType;
  source: 'first-party' | 'plugin';
  pluginName?: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ZoneStore {
  contributions: ZoneContribution[];
}

const useZoneStore = create<ZoneStore>()(() => ({ contributions: [] }));

// ─── API ──────────────────────────────────────────────────────────────────────

/** Register a component for a zone. Returns the id for later unregistration. */
export function registerZone(
  contrib: Omit<ZoneContribution, 'id'>,
): string {
  const id = nextZoneId();
  useZoneStore.setState((state) => ({
    contributions: [...state.contributions, { ...contrib, id }],
  }));
  return id;
}

/** Unregister a zone contribution by id. No-op if not found. */
export function unregisterZone(id: string): void {
  useZoneStore.setState((state) => ({
    contributions: state.contributions.filter((c) => c.id !== id),
  }));
}

/** Get all contributions for a specific zone, in registration order. */
export function getZoneContributions(zone: string): ZoneContribution[] {
  return useZoneStore.getState().contributions.filter((c) => c.zone === zone);
}

/** Return deduplicated list of all registered zone names. */
export function listAllZones(): string[] {
  const zones = useZoneStore.getState().contributions.map((c) => c.zone);
  return [...new Set(zones)];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** React hook — re-renders subscribers when contributions for `zone` change. */
export function useZoneContributions(zone: string): ZoneContribution[] {
  return useZoneStore((state) =>
    state.contributions.filter((c) => c.zone === zone),
  );
}
