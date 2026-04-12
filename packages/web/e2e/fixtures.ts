import { test as base, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Legacy fixtures (used by existing sandbox-based tests)
// ---------------------------------------------------------------------------

// Login helper — performs browser-based login and waits for dashboard.
async function browserLogin(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('/', { timeout: 10_000 });
}

/** Test fixture with admin authentication — logs in via browser before each test. */
export const adminTest = base.extend({
  page: async ({ page }, use) => {
    await browserLogin(page, 'testadmin', 'TestAdmin123!');
    await use(page);
  },
});

/** Test fixture with viewer authentication. */
export const viewerTest = base.extend({
  page: async ({ page }, use) => {
    await browserLogin(page, 'testviewer', 'TestView123!');
    await use(page);
  },
});

/** Test fixture with operator authentication. */
export const operatorTest = base.extend({
  page: async ({ page }, use) => {
    await browserLogin(page, 'testoperator', 'TestOperator123!');
    await use(page);
  },
});

/** Unauthenticated test (no login). */
export const anonTest = base;

// ---------------------------------------------------------------------------
// New fixtures (used by the comprehensive E2E suite)
// ---------------------------------------------------------------------------

/**
 * Ensures the page is authenticated. If the stored session has expired
 * (server returns redirect to /login), re-authenticates as root and
 * saves the refreshed storage state.
 */
async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Check if we got redirected to login
  if (page.url().includes('/login')) {
    await page.getByLabel('Username').fill('root');
    await page.getByLabel('Password').fill('TestRoot1234!');
    await page.getByRole('button', { name: /log in/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 15_000,
    });

    // Handle change-password redirect
    if (page.url().includes('/change-password')) {
      const newPwField = page.getByLabel(/new password/i).first();
      if (await newPwField.isVisible({ timeout: 3000 }).catch(() => false)) {
        await newPwField.fill('TestRoot1234!');
        const confirmField = page.getByLabel(/confirm/i).first();
        if (await confirmField.isVisible().catch(() => false)) {
          await confirmField.fill('TestRoot1234!');
        }
        await page.getByRole('button', { name: /change|save|submit/i }).click();
        await page.waitForURL('/', { timeout: 10_000 });
      }
    }

    // Save refreshed state so subsequent tests can reuse it
    await page.context().storageState({ path: 'e2e/.auth/user.json' });
  }
}

/**
 * Extended test that auto-refreshes auth if the session has expired.
 * Used by the comprehensive E2E suite (content-quality, navigation,
 * crud-flows, detail-pages, security-pages, settings).
 */
export const authedTest = base.extend({
  page: async ({ page }, use) => {
    await ensureAuthenticated(page);
    await use(page);
  },
});

export { expect };
