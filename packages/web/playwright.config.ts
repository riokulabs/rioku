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
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: SPA_BASE,
    storageState: STORAGE_STATE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
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
