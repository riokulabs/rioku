import type { MantineThemeOverride } from '@mantine/core';
import { sharedTheme } from './tokens';

/**
 * Rioku dark theme — Colorffy-derived palette.
 *
 * Design language:
 *   - Warm orange primary (#b33d0d → lighter tints) for CTAs and active states.
 *   - Cool-neutral surface tiers (#121212 base) for depth without warmth bleed.
 *   - Semantic colours (success/warning/danger/info) defined as full 10-shade
 *     Mantine palettes so filled/light/outline variants all resolve correctly.
 *
 * Surface tier hierarchy (see global.css):
 *   --clr-surface-a0  (#121212) — page background / sidebar
 *   --clr-surface-a10 (#282828) — cards / panels
 *   --clr-surface-a20 (#3f3f3f) — elevated / hover
 *   --clr-surface-a30 (#575757) — pressed / active-ish
 *   --clr-surface-a40 (#717171) — disabled background
 *   --clr-surface-a50 (#8b8b8b) — very-subtle tints (unused at scale)
 */

/** Primary — warm orange (Colorffy --clr-primary-a*). */
const riokuOrange: [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] = [
  '#fff4ec', // 0
  '#ffdcc4', // 1
  '#ffbd96', // 2
  '#fb9362', // 3 — hover tints on primary
  '#eb6f38', // 4
  '#d8551e', // 5 — vivid mid
  '#b33d0d', // 6 — primary anchor (Colorffy a0)
  '#8f2f08', // 7
  '#6b2305', // 8
  '#471603', // 9
];

/** Success — teal (Colorffy --clr-success-a*). */
const riokuSuccess: [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] = [
  '#e8f7f1',
  '#c4ebdb',
  '#9dd9c0',
  '#6dc5a2',
  '#46b286',
  '#2fa47a',
  '#22946e', // 6 — Colorffy a0
  '#197358',
  '#115442',
  '#0a382d',
];

/** Warning — amber (Colorffy --clr-warning-a*). */
const riokuWarning: [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] = [
  '#fbf2e1',
  '#f1dfb3',
  '#e5c880',
  '#d8b04e',
  '#c19535',
  '#b3892f',
  '#a87a2a', // 6 — Colorffy a0
  '#866021',
  '#634619',
  '#422e10',
];

/** Danger — deep red (Colorffy --clr-danger-a*). */
const riokuDanger: [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] = [
  '#fbe8e8',
  '#f1bcbc',
  '#e58888',
  '#d55858',
  '#bf3131',
  '#ae2626',
  '#9c2121', // 6 — Colorffy a0
  '#7a1a1a',
  '#591313',
  '#3b0c0c',
];

/** Info — navy blue (Colorffy --clr-info-a*). */
const riokuInfo: [string, string, string, string, string, string, string, string, string, string] =
  [
    '#e6edf5',
    '#bdcde6',
    '#8ba8d0',
    '#5a83b9',
    '#345fa0',
    '#27549a',
    '#21498a', // 6 — Colorffy a0
    '#1a3a6e',
    '#142c51',
    '#0c1d37',
  ];

export const darkTheme: MantineThemeOverride = {
  ...sharedTheme,
  primaryColor: 'riokuOrange',
  primaryShade: { light: 6, dark: 6 },
  colors: {
    riokuOrange,
    riokuSuccess,
    riokuWarning,
    riokuDanger,
    riokuInfo,
  },
};
