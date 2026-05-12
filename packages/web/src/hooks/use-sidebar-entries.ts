/**
 * useSidebarEntries — bridge hook for plugin-registered sidebar entries.
 *
 * Re-exports from `@/host/sidebar` through the hooks/ layer so that
 * components/ (which cannot import from host/ directly) can access the
 * plugin sidebar registry reactively.
 */

export { useSidebarEntries } from '@/host/sidebar';
export type { SidebarEntry, SidebarGroup } from '@/host/sidebar';
