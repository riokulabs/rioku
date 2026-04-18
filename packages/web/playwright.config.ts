import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
