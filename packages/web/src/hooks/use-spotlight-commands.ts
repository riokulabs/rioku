/**
 * useSpotlightCommands — bridge hook for plugin-registered spotlight commands.
 *
 * Re-exports from `@/host/spotlight` through the hooks/ layer so that
 * routes/ code can access the plugin spotlight registry reactively.
 */

export { useSpotlightCommands } from '@/host/spotlight';
export type { SpotlightCommand } from '@/host/spotlight';
