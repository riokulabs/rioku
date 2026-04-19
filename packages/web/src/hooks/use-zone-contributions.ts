/**
 * useZoneContributions — bridge hook for plugin-registered zone contributions.
 *
 * Re-exports from `@/host/zones` through the hooks/ layer so that
 * components/ (which cannot import from host/ directly) can access
 * zone contributions reactively.
 *
 * spec §9.5.1 / Task 1f.105
 */

export { useZoneContributions } from '@/host/zones';
export type { ZoneContribution } from '@/host/zones';
