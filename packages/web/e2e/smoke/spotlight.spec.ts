/**
 * Spotlight E2E smoke tests.
 *
 * Covers:
 *  - Ctrl+K opens the spotlight command palette.
 *  - Typing "services" surfaces the "Services" nav action.
 *  - Clicking the "Services" action navigates to /t/acme/services.
 *  - The `/` shortcut also opens spotlight (when not inside an input).
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('Ctrl+K opens spotlight and Services result navigates correctly', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/dashboard');

  // Open spotlight with Ctrl+K
  await page.keyboard.press('Control+k');

  // Mantine Spotlight renders a search input — wait for it to appear.
  // The input is typed by the user; we wait for an input that isn't already
  // a top-bar search (which is readOnly).
  const spotlightSearchInput = page.locator('input:not([readonly])').last();
  await expect(spotlightSearchInput).toBeVisible({ timeout: 5000 });

  // Search for "services"
  await spotlightSearchInput.fill('services');
  await page.waitForTimeout(300);

  // Mantine Spotlight renders each action as an UnstyledButton with data-action
  // attribute. Filter to the one whose text includes "Services".
  const servicesResult = page.locator('[data-action]').filter({ hasText: 'Services' }).first();

  await expect(servicesResult).toBeVisible({ timeout: 5000 });

  // Save a screenshot of the expanded spotlight
  await page.screenshot({ path: '/tmp/spotlight.png' });

  // Click it
  await servicesResult.click();

  // Should navigate to the services page
  await expect(page).toHaveURL(/\/t\/acme\/services/, { timeout: 8000 });
});

test('/ shortcut opens spotlight when not in a text input', async ({ authedPage: page }) => {
  await page.goto('/t/acme/dashboard');

  // Click somewhere neutral (not inside an input) to ensure focus is on body
  await page.locator('body').click({ position: { x: 640, y: 400 } });

  // Press /
  await page.keyboard.press('/');

  // Mantine Spotlight input should appear
  const spotlightSearchInput = page.locator('input:not([readonly])').last();
  await expect(spotlightSearchInput).toBeVisible({ timeout: 5000 });
});
