/**
 * useSpotlightCommands — bridge hook for plugin-registered spotlight commands.
 *
 * Re-exports from `@/host/spotlight` through the hooks/ layer so that
 * routes/ code can access the plugin spotlight registry reactively.
 *
 * spec §9.5.6 / Task 1f.110
 */

export { useSpotlightCommands } from '@/host/spotlight';
export type { SpotlightCommand } from '@/host/spotlight';
