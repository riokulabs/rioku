import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from '../axe';

test('tenants page renders and has no serious a11y violations', async ({ page }) => {
  await page.goto('/tenants');
  // Wait for the mock store to finish seeding before asserting page content.
  // The dynamic import of mock-seed (which now includes seed-zones) may complete
  // after the browser 'load' event, so we wait for the store to be hydrated.
  await page.waitForFunction(() => {
    const store = (window as unknown as { __RIOKU_STORE?: { getState: () => { users: Record<string, unknown> } } }).__RIOKU_STORE;
    if (!store) return false;
    return Object.keys(store.getState().users).length > 0;
  }, null, { timeout: 10000 });
  await expect(page.getByRole('heading', { name: /tenants/i })).toBeVisible();
  await expectNoA11yViolations(page);
});
