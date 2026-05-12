/**
 * useZoneContributions — bridge hook for plugin-registered zone contributions.
 *
 * Re-exports from `@/host/zones` through the hooks/ layer so that
 * components/ (which cannot import from host/ directly) can access
 * zone contributions reactively.
 */

export { useZoneContributions } from '@/host/zones';
export type { ZoneContribution } from '@/host/zones';
