/**
 * StatusBadge — semantic badge with consistent variant + color per status kind.
 *
 * Rule: badges whose purpose is to DRAW ATTENTION (error, warn, success) use
 * `variant="filled"` for maximum contrast in both light and dark mode.
 * Informational / categorical badges use `variant="light"` (soft tint) or
 * `variant="outline"` (e.g. paused, neutral).
 *
 * WCAG AA note: `variant="filled"` with white text meets 4.5:1 for all
 * saturated Mantine colors (red, teal, green, yellow uses dark text).
 * `variant="light"` with color="gray" can be too muted in dark mode — use
 * `variant="outline"` for gray-neutral states instead.
 */
import { Badge } from '@mantine/core';
import type { BadgeProps, BadgeVariant } from '@mantine/core';

export type StatusKind =
  | 'success' // filled teal  — operation succeeded, healthy
  | 'warn' // filled yellow — degraded, needs attention
  | 'error' // filled red    — failed, unhealthy, revoked
  | 'info' // light  blue   — informational label
  | 'neutral' // outline gray  — disabled/off/unknown
  | 'active' // light  green  — enabled, live, running
  | 'paused'; // outline gray  — explicitly paused/disabled

const BADGE_VARIANT: Record<StatusKind, BadgeVariant> = {
  success: 'filled',
  warn: 'filled',
  error: 'filled',
  info: 'light',
  neutral: 'outline',
  active: 'light',
  paused: 'outline',
};

// Yellow filled needs dark text for contrast — Mantine handles this
// automatically via autoContrast. All other filled colors render white text.
const BADGE_COLOR: Record<StatusKind, string> = {
  success: 'teal',
  warn: 'yellow',
  error: 'red',
  info: 'blue',
  neutral: 'gray',
  active: 'green',
  paused: 'gray',
};

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant' | 'color'> {
  kind: StatusKind;
}

export function StatusBadge({ kind, children, ...rest }: StatusBadgeProps) {
  return (
    <Badge variant={BADGE_VARIANT[kind]} color={BADGE_COLOR[kind]} autoContrast {...rest}>
      {children}
    </Badge>
  );
}
