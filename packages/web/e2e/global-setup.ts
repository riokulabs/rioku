/**
 * Playwright global setup.
 *
 * Two responsibilities:
 *
 *   1. Build the sample plugin (packages/web/sample-plugin/) if its dist
 *      bundle is missing, so the dev-sideload smoke test (Task 1f.123)
 *      can load it via the `/sample-plugin/dist/plugin.mjs` dev
 *      middleware.
 *   2. Pre-compute a root-authenticated session against the running
 *      sandbox daemon and persist it to `e2e/.auth/root-state.json` so
 *      individual tests can reuse it via `storageState` instead of each
 *      paying the login round-trip.
 *
 * If the daemon is unreachable (local dev without sandbox), step 2 is a
 * soft no-op — we warn and return, letting Playwright surface a clearer
 * error if a test actually requires the persisted state.
 *
 * Runs once per `pnpm test:e2e` invocation, before any workers start.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request, type FullConfig } from '@playwright/test';

function buildSamplePluginIfNeeded(webRoot: string): void {
  const sampleDir = join(webRoot, 'sample-plugin');
  const distBundle = join(sampleDir, 'dist', 'plugin.mjs');

  if (existsSync(distBundle)) return;

  console.info('[e2e/global-setup] building sample-plugin...');
  // Defer to the sample-plugin's own `build` script (cross-platform; avoids
  // hard-coded `node_modules/.bin/...` paths that break on Windows CI).
  execSync('pnpm build', {
    cwd: sampleDir,
    stdio: 'inherit',
  });

  if (!existsSync(distBundle)) {
    throw new Error(`[e2e/global-setup] expected ${distBundle} after build, but it is missing.`);
  }
}

async function precomputeRootAuth(webRoot: string, baseURL: string): Promise<void> {
  const authDir = join(webRoot, 'e2e', '.auth');
  const statePath = join(authDir, 'root-state.json');

  // Probe daemon health first; soft-skip if unreachable.
  const probe = await request.newContext({ baseURL });
  try {
    const health = await probe.get('/healthz', {
      timeout: 3000,
      failOnStatusCode: false,
    });
    if (!health.ok()) {
      console.warn(
        `[e2e/global-setup] daemon ${baseURL} returned ${String(
          health.status(),
        )} on /healthz — skipping auth precompute.`,
      );
      return;
    }
  } catch (err) {
    console.warn(
      `[e2e/global-setup] daemon ${baseURL} unreachable (${String(err)}) — skipping auth precompute.`,
    );
    return;
  } finally {
    await probe.dispose();
  }

  const username = process.env.RIOKU_ROOT_USERNAME ?? 'root';
  const password = process.env.SANDBOX_ROOT_PASSWORD ?? 'TestRoot1234!';

  const ctx = await request.newContext({ baseURL });
  try {
    const res = await ctx.post('/api/v1/auth/login', {
      data: { username, password },
      failOnStatusCode: false,
    });
    if (!res.ok()) {
      console.warn(
        `[e2e/global-setup] login failed (${String(res.status())}: ${await res.text()}) — skipping auth precompute.`,
      );
      return;
    }

    if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });
    await ctx.storageState({ path: statePath });
    console.info(`[e2e/global-setup] persisted root auth state to ${statePath}`);
  } finally {
    await ctx.dispose();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const webRoot = resolve(here, '..');

  buildSamplePluginIfNeeded(webRoot);

  // Resolve baseURL: prefer explicit override, then the project's `use.baseURL`,
  // then the documented sandbox default.
  const projectBase = config.projects[0]?.use.baseURL;
  const baseURL = process.env.RIOKU_DAEMON_BASE ?? projectBase ?? 'http://localhost:7778';

  await precomputeRootAuth(webRoot, baseURL);
}
