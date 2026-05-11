import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Stage-2: the SPA is served by the daemon binary at :7778 (go:embed of
// the production build). E2E tests run against that daemon-served SPA,
// not the Vite dev server — `make sandbox` boots the daemon before
// Playwright runs. Locally, override RIOKU_SPA_BASE to point at a
// different host while iterating (e.g. running Vite dev separately).
const SPA_BASE =
  process.env.RIOKU_DAEMON_BASE ?? process.env.RIOKU_SPA_BASE ?? 'http://localhost:7778';

// Pre-computed root-auth session, written by e2e/global-setup.ts after a
// successful login probe against the daemon. Falls back to `undefined`
// when the file doesn't exist (cold checkout, daemon unreachable) so
// Playwright surfaces a clearer error than a missing-file crash.
const here = dirname(fileURLToPath(import.meta.url));
const STORAGE_STATE_PATH = resolve(here, 'e2e/.auth/root-state.json');
const STORAGE_STATE = existsSync(STORAGE_STATE_PATH) ? STORAGE_STATE_PATH : undefined;

export default defineConfig({
  testDir: './e2e',
  // Build the sample plugin before any test runs (Task 1f.123).
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  // Stage-2 transition: most existing e2e specs were authored against
  // the dev-server mock store (window.__RIOKU_STORE, seedStore), which
  // no longer exists at runtime now that the SPA is served by the
  // daemon binary. Only audit-flow.spec.ts has been migrated to the
  // real-daemon storageState path. The rest are deliberately ignored
  // here until they are individually rewritten — running them stalls
  // each shard for the full 30s × retry × test-count budget. Track
  // re-enable in the stage-2 follow-up issue.
  testIgnore: [
    '**/a11y/**',
    '**/visual/**',
    '**/auth/full-flow.spec.ts',
    '**/notifications/notifications-flow.spec.ts',
    '**/smoke/ai-traces.spec.ts',
    '**/smoke/auth.spec.ts',
    '**/smoke/dashboards.spec.ts',
    '**/smoke/dashboard-builder.spec.ts',
    '**/smoke/sites.spec.ts',
    '**/smoke/settings.spec.ts',
    '**/smoke/cluster-flow.spec.ts',
    '**/smoke/shell.spec.ts',
    '**/smoke/hello.spec.ts',
    '**/smoke/plugin-signers.spec.ts',
    '**/super-admin/super-admin-flow.spec.ts',
    // Plugin-dev-sideload + install-flow + impersonation require Vite
    // dev-server middleware (`/sample-plugin/*` route), a populated
    // marketplace catalog, and multi-user impersonation token state
    // respectively — none of which the daemon-served SPA at :7778
    // exposes today. Track follow-ups in the stage-2 close-out issue
    // before re-enabling.
    '**/smoke/plugin-dev-sideload.spec.ts',
    '**/smoke/plugin-install-flow.spec.ts',
    '**/smoke/impersonation.spec.ts',
    // RTL spec was authored against the stage-1 mock-store with a
    // hard-coded `derrick` profile button. Stage-2 logs in as `root`,
    // so the button-filter never matches and the i18next-localStorage
    // fallback also fails on the authedPage fixture's localStorage
    // wipe. Re-enable after rewriting against the real profile menu.
    '**/smoke/rtl.spec.ts',
    // Cluster nodes can only be added via raft enrollment from a
    // real second daemon. The single-host sandbox surfaces only the
    // bootstrap node, and the spec expects `primary`/`replica` role
    // chips that only appear in a multi-node deployment.
    '**/smoke/cluster.spec.ts',
    // Sidebar-collapse asserts pixel-level box geometry after a
    // Mantine CSS transition. Needs a deterministic mock of the
    // Navbar width transition or a screenshot threshold tolerance —
    // either way, scope creep for this PR.
    '**/smoke/sidebar-collapse.spec.ts',
  ],
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: SPA_BASE,
    storageState: STORAGE_STATE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
    // Pin the Accept-Language fingerprint inputs. The daemon binds each
    // session cookie to sha256(User-Agent + Accept-Language); if test
    // contexts emit any other AL than the one global-setup used at login
    // time, the cookie is rejected as "invalid" and every test that
    // depends on storageState lands on the /login page instead of the
    // app shell. Pinning both sides to 'en-US' keeps them aligned.
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US' },
  },
  expect: {
    timeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Force dark color scheme so Mantine's OS-preference resolution picks
        // the dark theme; avoids light-mode contrast failures in headless CI.
        colorScheme: 'dark',
      },
    },
  ],
  // No webServer: tests run against the running daemon (`make sandbox`
  // before invoking Playwright). The CI e2e workflow boots the sandbox
  // first; locally export RIOKU_SPA_BASE if pointing elsewhere.
});
