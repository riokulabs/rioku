/**
 * <WidgetRenderer> — dispatcher for built-in + plugin-registered widget types.
 *
 * Lookup order:
 *   1. `BUILT_IN_WIDGETS[widget.kind]` — the 10 Plan 4 first-party types.
 *   2. Plugin-registered widgets via `@/host/widgets` (`useWidgets()`).
 *   3. Fallback: an error Alert explaining the missing kind.
 *
 * Built-in widget components accept `{ widget, data, loading, error }` per
 * `WidgetRenderProps`. Plugin-registered widgets accept `{ data, config }` per
 * the legacy plan-1 contract — we adapt by passing `widget.config` as `config`.
 *
 * spec §9.5.8 + Plan 4 Task 4b.12
 */

import { Alert } from '@mantine/core';
import { IconPlugOff } from '@tabler/icons-react';
import { BUILT_IN_WIDGETS } from '@/features/widgets/registry';
import { useWidgets } from '@/hooks/use-widgets';
import type { Widget } from '@/api/resources';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WidgetRendererProps {
  /** The widget configuration record. */
  widget: Widget;
  /** Result of `runWidgetQuery` for this widget. */
  data: unknown;
  /** True while the query is still resolving. */
  loading: boolean;
  /** Error message when the query failed. */
  error?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WidgetRenderer({ widget, data, loading, error }: WidgetRendererProps) {
  const pluginWidgets = useWidgets();

  const builtIn = BUILT_IN_WIDGETS[widget.kind];
  if (builtIn) {
    const Component = builtIn.component;
    const props: WidgetRendererProps = { widget, data, loading };
    if (error !== undefined) props.error = error;
    return <Component {...props} />;
  }

  const plugin = pluginWidgets.find((w) => w.type === widget.kind);
  if (plugin) {
    const Component = plugin.component;
    // Plugin-registered widgets follow the plan-1 contract: `{ data, config }`.
    return <Component data={data} config={widget.config} />;
  }

  return (
    <Alert icon={<IconPlugOff size={16} />} color="red" variant="light" title="Unknown widget type">
      No renderer registered for widget kind <strong>{widget.kind}</strong>. The plugin providing
      this widget may not be installed, or the widget is stale and should be removed from the
      dashboard.
    </Alert>
  );
}
