import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { REQUIRED_EXTERNALS } from '../src/host/plugin-externals';

/**
 * Sample-plugin build — spec §9.10.2 / Task 1f.122.
 *
 * Produces `dist/plugin.mjs`, an ESM bundle that the host loads dynamically.
 * Every package in REQUIRED_EXTERNALS is marked external so the host-provided
 * copy is reused at runtime (no duplicated React / Mantine trees).
 *
 * The sample plugin imports only `RiokuHost` (a TS type) from
 * `@rioku/plugin-sdk`, so nothing from the SDK survives to runtime — the
 * external marker below is enough to keep Vite from trying to resolve it.
 */
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/plugin.tsx', import.meta.url)),
      formats: ['es'],
      fileName: () => 'plugin.mjs',
    },
    rollupOptions: {
      external: REQUIRED_EXTERNALS as unknown as string[],
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
});
