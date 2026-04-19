/**
 * Playwright global setup.
 *
 * Builds the sample plugin (packages/web/sample-plugin/) if its dist bundle is
 * missing, so the dev-sideload smoke test (Task 1f.123) can load it via the
 * `/sample-plugin/dist/plugin.mjs` dev middleware.
 *
 * Runs once per `pnpm test:e2e` invocation, before any workers start.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const webRoot = resolve(here, '..');
  const sampleDir = join(webRoot, 'sample-plugin');
  const distBundle = join(sampleDir, 'dist', 'plugin.mjs');

  if (existsSync(distBundle)) return;

  console.info('[e2e/global-setup] building sample-plugin...');
  execSync('../node_modules/.bin/vite build', {
    cwd: sampleDir,
    stdio: 'inherit',
  });

  if (!existsSync(distBundle)) {
    throw new Error(
      `[e2e/global-setup] expected ${distBundle} after build, but it is missing.`,
    );
  }
}
