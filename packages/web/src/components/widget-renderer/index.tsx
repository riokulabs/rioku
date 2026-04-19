/**
 * <WidgetRenderer> — renders a registered widget by type.
 *
 * Looks up the widget type in the registry and renders it with the
 * provided data and config.  Falls back to an <EmptyState> when the
 * type is not registered (plugin may not be installed).
 *
 * The dashboard builder (Plan 4) uses this to render each widget slot.
 * Stage-1: registry is ready; no builder UI yet.
 *
 * spec §9.5.8 / Task 1f.110
 */

import { Alert } from '@mantine/core';
import { IconPlugOff } from '@tabler/icons-react';
import { useWidgets } from '@/hooks/use-widgets';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WidgetRendererProps {
  /** The widget type string (matches `WidgetRegistration.type`). */
  type: string;
  /** Runtime data passed to the widget component. */
  data: unknown;
  /** User config for the widget instance. */
  config: unknown;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WidgetRenderer({ type, data, config }: WidgetRendererProps) {
  const widgets = useWidgets();
  const registration = widgets.find((w) => w.type === type);

  if (!registration) {
    return (
      <Alert
        icon={<IconPlugOff size={16} />}
        color="gray"
        variant="light"
        title="Widget not available"
      >
        No widget registered for type <strong>{type}</strong>. The plugin that
        provides this widget may not be installed or enabled.
      </Alert>
    );
  }

  const Component = registration.component;
  return <Component data={data} config={config} />;
}
