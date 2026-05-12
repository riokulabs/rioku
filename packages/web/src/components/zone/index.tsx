/**
 * <Zone> — injection-zone renderer for plugin contributions.
 *
 * Reads zone contributions registered via `host.zones.register(...)` and
 * renders them in a vertical Stack.  Wraps in a semantic `role="region"`
 * landmark only when contributions are present so empty zones leave zero
 * DOM footprint.
 */

import { Stack } from '@mantine/core';
import { useZoneContributions } from '@/hooks/use-zone-contributions';
import type { ReactNode } from 'react';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ZoneProps {
  /** Zone name, e.g. "dashboard.summary" or "service.detail.header-actions" */
  id: string;
  /** Rendered when no contributions are registered and no children provided. */
  fallback?: ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders all components registered for the given zone `id`.
 *
 * - If the zone has no contributions AND no `fallback`, returns null (no DOM).
 * - Each contribution is rendered with a stable `key` equal to its registration id.
 * - When non-empty, wraps in a `role="region"` landmark with `aria-label`.
 */
export function Zone({ id, fallback }: ZoneProps) {
  const contributions = useZoneContributions(id);

  if (contributions.length === 0) {
    return fallback ? <>{fallback}</> : null;
  }

  return (
    <Stack role="region" aria-label={`Plugin contributions for ${id}`} gap="xs" data-zone={id}>
      {contributions.map((contrib) => {
        const Component = contrib.component;
        return <Component key={contrib.id} />;
      })}
    </Stack>
  );
}
