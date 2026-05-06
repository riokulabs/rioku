import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    css: true,
    // Default to dot reporter in CI for compact output; set VITEST_REPORTER=verbose for full output.
    reporters: process.env.VITEST_REPORTER === 'verbose' ? ['verbose'] : process.env.CI ? ['dot'] : ['default'],
    // Cap workers so local `pnpm test` doesn't peg every core.
    // CI can override via `vitest run --max-workers=N` if it wants more parallelism.
    //
    // Vitest 4 removed `test.poolOptions` in favour of a top-level
    // `maxWorkers` option. See https://vitest.dev/guide/migration#pool-rework
    pool: 'threads',
    maxWorkers: '50%',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'src/routeTree.gen.ts', 'src/test/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@rioku/plugin-sdk': fileURLToPath(new URL('./src/host/sdk.ts', import.meta.url)),
    },
  },
});
