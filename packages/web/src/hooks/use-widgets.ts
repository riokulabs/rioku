/**
 * useWidgets — bridge hook for plugin-registered dashboard widgets.
 *
 * Re-exports from `@/host/widgets` through the hooks/ layer so that
 * components/ code can access the widget registry reactively.
 *
 * spec §9.5.8 / Task 1f.110
 */

export { useWidgets } from '@/host/widgets';
export type { WidgetRegistration } from '@/host/widgets';
