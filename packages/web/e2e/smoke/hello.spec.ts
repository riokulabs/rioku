import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from '../axe';

test('home page renders and has no serious a11y violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /hello/i })).toBeVisible();
  await expectNoA11yViolations(page);
});
