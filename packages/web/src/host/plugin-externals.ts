/**
 * Plugin externals list — spec §9.10.2.
 *
 * Single source of truth for all packages that plugin bundles MUST NOT inline.
 * Used by:
 *   1. The static bundle scanner (`plugin-validate.ts`) — B3 enforcement.
 *   2. The plugin scaffold generator (`scripts/plugin-init.mjs`) — generates
 *      the correct Vite `external` config.
 *   3. This list is re-exported via `@rioku/plugin-sdk` so plugin authors can
 *      copy it into their own Vite config without drift.
 *
 * Keep this list in sync with `src/host/sdk.ts` exports.
 */

export const REQUIRED_EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@mantine/core',
  '@mantine/hooks',
  '@mantine/form',
  '@mantine/dates',
  '@mantine/notifications',
  '@mantine/modals',
  '@mantine/spotlight',
  '@mantine/charts',
  '@mantine/code-highlight',
  '@mantine/dropzone',
  '@mantine/nprogress',
  '@mantine/tiptap',
  '@mantine/carousel',
  '@tanstack/react-query',
  '@tanstack/react-router',
  '@tanstack/react-table',
  '@tabler/icons-react',
  'i18next',
  'react-i18next',
  'zod',
  'recharts',
  '@monaco-editor/react',
  'shiki',
  '@rioku/plugin-sdk',
] as const;

export type RequiredExternal = (typeof REQUIRED_EXTERNALS)[number];
