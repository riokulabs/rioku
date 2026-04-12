import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: [
    // Legacy sandbox-based tests (use different credentials / backend expectations)
    '**/a11y.spec.ts',
    '**/dashboard.spec.ts',
    '**/global-setup.ts',
    '**/global-teardown.ts',
    '**/performance.spec.ts',
    '**/policies.spec.ts',
    '**/profile.spec.ts',
    '**/rbac.spec.ts',
    '**/responsive.spec.ts',
    '**/roles.spec.ts',
    '**/routes.spec.ts',
    '**/security-sessions.spec.ts',
    '**/security.spec.ts',
    '**/services.spec.ts',
    '**/theme.spec.ts',
    '**/traffic-analytics.spec.ts',
    '**/traffic-live.spec.ts',
    '**/users.spec.ts',
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI
    ? [['html', { outputFolder: 'playwright-report' }], ['github']]
    : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    storageState: 'e2e/.auth/user.json',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { storageState: undefined },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
