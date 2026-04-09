import { test as base, expect, type Page } from '@playwright/test';

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

export { expect };
