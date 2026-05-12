/**
 * Spotlight-command + resource registry.
 * Plugins register commands (static keyboard-accessible actions) and
 * resources (async search providers). The spotlight component reads both.
 *
 * Command duplicate policy: overwrite with a warning in dev (same id).
 * Resource types are unique — duplicate type overwrites.
 */

import { create } from 'zustand';
import { makeIdFactory } from '@/lib/id-generator';

const nextSpotlightId = makeIdFactory('spotlight');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpotlightCommand {
  id: string;
  label: string;
  keywords?: string[];
  onAction: () => void;
  group?: string;
  source: 'first-party' | 'plugin';
  pluginName?: string;
}

export interface SpotlightResource {
  type: string;
  search: (query: string) => Promise<{ label: string; onAction: () => void }[]>;
  source: 'first-party' | 'plugin';
  pluginName?: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface SpotlightStore {
  commands: SpotlightCommand[];
  resources: SpotlightResource[];
}

const useSpotlightStore = create<SpotlightStore>()(() => ({
  commands: [],
  resources: [],
}));

// ─── Command API ──────────────────────────────────────────────────────────────

/**
 * Register a spotlight command. Returns the id for later unregistration.
 * Accepts an optional `id` in the input — if omitted, one is generated.
 * Re-registering the same id overwrites (warns in dev).
 */
export function registerSpotlightCommand(
  cmd: Omit<SpotlightCommand, 'id'> & { id?: string },
): string {
  const id = cmd.id ?? nextSpotlightId();
  useSpotlightStore.setState((state) => {
    const existing = state.commands.find((c) => c.id === id);
    if (existing && import.meta.env.DEV) {
      console.warn(`[host.spotlight] Command "${id}" already registered — overwriting.`);
    }
    const commands = existing
      ? state.commands.map((c) => (c.id === id ? { ...cmd, id } : c))
      : [...state.commands, { ...cmd, id }];
    return { commands };
  });
  return id;
}

/** Unregister a spotlight command by id. No-op if not found. */
export function unregisterSpotlightCommand(id: string): void {
  useSpotlightStore.setState((state) => ({
    commands: state.commands.filter((c) => c.id !== id),
  }));
}

/** Return all registered spotlight commands. */
export function listSpotlightCommands(): SpotlightCommand[] {
  return useSpotlightStore.getState().commands;
}

// ─── Resource API ─────────────────────────────────────────────────────────────

/**
 * Register a spotlight search resource. Resources use `type` as natural key.
 * Duplicate type overwrites (warns in dev).
 */
export function registerSpotlightResource(resource: SpotlightResource): void {
  useSpotlightStore.setState((state) => {
    const existing = state.resources.find((r) => r.type === resource.type);
    if (existing && import.meta.env.DEV) {
      console.warn(
        `[host.spotlight] Resource type "${resource.type}" already registered — overwriting.`,
      );
    }
    const resources = existing
      ? state.resources.map((r) => (r.type === resource.type ? resource : r))
      : [...state.resources, resource];
    return { resources };
  });
}

/** Unregister a spotlight resource by type. No-op if not found. */
export function unregisterSpotlightResource(type: string): void {
  useSpotlightStore.setState((state) => ({
    resources: state.resources.filter((r) => r.type !== type),
  }));
}

/** Return all registered spotlight resources. */
export function listSpotlightResources(): SpotlightResource[] {
  return useSpotlightStore.getState().resources;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** React hook — re-renders when spotlight commands change. */
export function useSpotlightCommands(): SpotlightCommand[] {
  return useSpotlightStore((state) => state.commands);
}

/** React hook — re-renders when spotlight resources change. */
export function useSpotlightResources(): SpotlightResource[] {
  return useSpotlightStore((state) => state.resources);
}
