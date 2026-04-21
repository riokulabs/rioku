import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Build the sample plugin before any test runs (Task 1f.123).
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Keep worker count low: every test boots a fresh browser context which
  // triggers the full mock-store seed (300 audit entries, 200 AI traces, etc.)
  // via the shared Vite dev server. Higher concurrency overloads the dev
  // server and causes timeout flakes rather than reveals real bugs.
  workers: process.env.CI ? 1 : 2,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Bypass CSP in dev: Vite injects HMR scripts without nonces so the
    // nonce-based CSP blocks them. CSP header correctness is tested in CI
    // against the production build; bypassing here lets E2E smoke tests
    // verify UI behaviour without being blocked by dev-server nonce mismatch.
    bypassCSP: true,
    // Increase the default assertion timeout. The authedPage fixture clears
    // localStorage on every navigation, triggering a full mock-store re-seed
    // (dynamic import + seedStore). With Plan 8's larger seed (including
    // seed-zones.tsx importing Mantine components), re-seeding can take
    // 6–12 s on a shared Vite dev server. 15 s is sufficient headroom.
    actionTimeout: 15000,
  },
  expect: {
    // Same reasoning as actionTimeout above: first-page-load assertions need
    // time for the mock store to finish seeding after each navigation.
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
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
