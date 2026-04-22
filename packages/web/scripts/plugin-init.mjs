#!/usr/bin/env node
/**
 * Plugin scaffold generator — Task 1f.116.
 *
 * Creates a new plugin directory under `../plugins/<name>/` with:
 *   - rioku-plugin.yaml  — manifest template
 *   - src/plugin.ts      — sample default export
 *   - vite.config.ts     — Vite config with REQUIRED_EXTERNALS
 *   - package.json       — with pnpm build / pnpm validate scripts
 *
 * Usage:
 *   node scripts/plugin-init.mjs <plugin-name>
 *
 * The plugin name must be lowercase alphanumeric with hyphens, starting and
 * ending with an alphanumeric character (e.g. "my-plugin").
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = resolve(__dirname, '../../plugins');

// ─── Externals list (must match src/host/plugin-externals.ts) ────────────────
// Keep in sync — a future enhancement is to import this from the built SDK.

const REQUIRED_EXTERNALS = [
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
];

// ─── Validation ───────────────────────────────────────────────────────────────

const name = process.argv[2];

if (!name) {
  console.error('Usage: node scripts/plugin-init.mjs <plugin-name>');
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
  console.error(
    `Error: plugin name "${name}" is invalid.\n` +
      'Name must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric.',
  );
  process.exit(1);
}

const pluginDir = join(PLUGINS_DIR, name);

if (existsSync(pluginDir)) {
  console.error(`Error: directory already exists: ${pluginDir}`);
  process.exit(1);
}

// ─── File templates ───────────────────────────────────────────────────────────

const MANIFEST_YAML = `\
# rioku-plugin.yaml — Rioku plugin manifest (spec §9.2)
name: ${name}
version: 0.1.0
displayName: "${name}"
author:
  name: "Your Name"
  url: "https://example.com"

abi:
  minVersion: 1
  # maxVersion: 1  # uncomment to cap compatibility

# Parts declare entry points. Remove any section you don't need.
parts:
  admin: dist/admin.mjs    # compiled ESM bundle for the admin UI

# Isolation mode: shared (default) | sandbox (iframe — stage-2+)
isolation: shared

# Declare any custom permissions this plugin needs.
# permissions:
#   - key: "com.example.${name}:action"
#     description: "Description of what this permission allows"

# Declare which injection zones this plugin writes to.
# zones: []

# Settings scope: global | tenant | both
# settings:
#   scope: tenant
`;

const PACKAGE_JSON = JSON.stringify(
  {
    name: `@rioku-plugin/${name}`,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'tsc -b && vite build',
      validate: 'node ../../web/scripts/validate-plugin-bundle.mjs dist/admin.mjs',
      dev: 'vite build --watch',
      typecheck: 'tsc --noEmit',
    },
    devDependencies: {
      '@rioku/plugin-sdk': 'workspace:*',
      '@types/react': '19.2.5',
      typescript: '6.0.3',
      vite: '8.0.8',
    },
    peerDependencies: {
      react: '19.2.5',
      '@rioku/plugin-sdk': '*',
    },
  },
  null,
  2,
);

const VITE_CONFIG = `\
import { defineConfig } from 'vite';

// REQUIRED_EXTERNALS — every package in this list MUST stay external.
// The host (admin shell) provides these at runtime via its module map.
// Bundling any of these produces a build-contract violation (spec §9.10.2).
const REQUIRED_EXTERNALS = ${JSON.stringify(REQUIRED_EXTERNALS, null, 2)};

export default defineConfig({
  build: {
    lib: {
      entry: 'src/plugin.ts',
      formats: ['es'],
      fileName: 'admin',
    },
    rollupOptions: {
      external: REQUIRED_EXTERNALS,
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
`;

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ESNext', 'DOM'],
      jsx: 'react-jsx',
      strict: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: true,
    },
    include: ['src'],
  },
  null,
  2,
);

const PLUGIN_TS = `\
/**
 * ${name} — Rioku admin plugin.
 *
 * Default export is called by the plugin host at install time.
 * The \`host\` argument provides all 12 SDK surfaces.
 * Register your contributions here; they are automatically cleaned up on unload.
 */
import type { RiokuHost } from '@rioku/plugin-sdk';

export default async function register(host: RiokuHost): Promise<void> {
  // Example: register a sidebar entry
  // host.sidebar.register({
  //   group: 'plugins',
  //   label: '${name}',
  //   path: '/plugins/${name}',
  //   source: 'plugin',
  //   pluginName: '${name}',
  // });
  console.info('[${name}] registered');
}
`;

// ─── Create files ─────────────────────────────────────────────────────────────

mkdirSync(join(pluginDir, 'src'), { recursive: true });
mkdirSync(join(pluginDir, 'dist'), { recursive: true });

writeFileSync(join(pluginDir, 'rioku-plugin.yaml'), MANIFEST_YAML);
writeFileSync(join(pluginDir, 'package.json'), PACKAGE_JSON);
writeFileSync(join(pluginDir, 'vite.config.ts'), VITE_CONFIG);
writeFileSync(join(pluginDir, 'tsconfig.json'), TSCONFIG);
writeFileSync(join(pluginDir, 'src', 'plugin.ts'), PLUGIN_TS);

console.info(`Plugin scaffold created at: ${pluginDir}`);
console.info('');
console.info('Next steps:');
console.info(`  cd ${pluginDir}`);
console.info('  pnpm install');
console.info('  pnpm build');
console.info('  pnpm validate');
