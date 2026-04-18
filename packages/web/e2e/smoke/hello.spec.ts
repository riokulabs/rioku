import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from '../axe';

test('tenants page renders and has no serious a11y violations', async ({ page }) => {
  await page.goto('/tenants');
  await expect(page.getByRole('heading', { name: /tenants/i })).toBeVisible();
  await expectNoA11yViolations(page);
});
