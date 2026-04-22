import type { MantineThemeOverride } from '@mantine/core';
import { sharedTheme } from './tokens';

/**
 * Rioku dark theme — modern SaaS-admin palette.
 *
 * Design goals:
 *   - Deep cool-grey backgrounds (not neutral/warm grey) for a premium feel.
 *   - Muted emerald primary — saturated but not neon spring-green.
 *   - Explicit surface elevation tiers so cards/modals read as lifted.
 *   - CSS variables in global.css bind the surface levels to Mantine tokens
 *     so every Mantine component inherits them automatically.
 *
 * Surface tier hierarchy (see global.css for hex values):
 *   body (#0e0f10)          — page background (deepest)
 *   default (#151618)       — card / panel surface
 *   default-hover (#1c1d20) — elevated / hover state
 *   default-border (#27282c)— subtle separator
 *   text (#e9eaec)          — high-contrast body text
 */

/**
 * Muted emerald — Rioku green, desaturated to reduce neon effect.
 *
 * Shade mapping (index 0–9):
 *   0–4  = light tints (hover states, tinted backgrounds in light mode)
 *   5    = mid — used as accent in light mode (primaryShade.light)
 *   6    = primary dark (primaryShade.dark below)
 *   7–9  = deep variants (focus rings, active states)
 */
const riokuGreen: [string, string, string, string, string, string, string, string, string, string] =
  [
    '#edfaf3', // 0 — near-white tint
    '#c8f5df', // 1 — light tint
    '#98e8c4', // 2
    '#5fd5a4', // 3
    '#30bc84', // 4
    '#1aa068', // 5 — vivid mid (primaryShade.light)
    '#0e8050', // 6 — muted emerald primary (primaryShade.dark)
    '#0b6340', // 7
    '#084830', // 8
    '#053222', // 9 — near-black
  ];

export const darkTheme: MantineThemeOverride = {
  ...sharedTheme,
  primaryColor: 'riokuGreen',
  primaryShade: { light: 5, dark: 6 },
  colors: {
    riokuGreen,
  },
};
