/**
 * Plugin-route registry — spec §9.5.2
 *
 * Plugins register routes here; the router (app/router.tsx, Task 1f.106)
 * reads and injects them into the TanStack Router route tree.
 *
 * Duplicate-path policy: reject (warn in dev, skip duplicate silently).
 * Routes must have unique paths — duplicate paths would cause router ambiguity.
 */

import { create } from 'zustand';
import type React from 'react';
import { makeIdFactory } from '@/lib/id-generator';

const nextRouteId = makeIdFactory('route');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouteContribution {
  id: string;
  path: string;
  component: React.ComponentType;
  source: 'first-party' | 'plugin';
  pluginName?: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface RouteStore {
  contributions: RouteContribution[];
}

const useRouteStore = create<RouteStore>()(() => ({ contributions: [] }));

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Register a plugin route. Returns the id for later unregistration.
 * Rejects duplicate paths — warns in dev, no-ops in production.
 */
export function registerRoute(
  contrib: Omit<RouteContribution, 'id'>,
): string {
  const existing = useRouteStore
    .getState()
    .contributions.find((c) => c.path === contrib.path);
  if (existing) {
    if (import.meta.env.DEV) {
      console.warn(
        `[host.routes] Duplicate path "${contrib.path}" — registration rejected. Existing id: ${existing.id}`,
      );
    }
    return existing.id;
  }
  const id = nextRouteId();
  useRouteStore.setState((state) => ({
    contributions: [...state.contributions, { ...contrib, id }],
  }));
  return id;
}

/** Unregister a route contribution by id. No-op if not found. */
export function unregisterRoute(id: string): void {
  useRouteStore.setState((state) => ({
    contributions: state.contributions.filter((c) => c.id !== id),
  }));
}

/** Return all registered plugin routes. */
export function listPluginRoutes(): RouteContribution[] {
  return useRouteStore.getState().contributions;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** React hook — re-renders subscribers when route contributions change. */
export function useRouteContributions(): RouteContribution[] {
  return useRouteStore((state) => state.contributions);
}
