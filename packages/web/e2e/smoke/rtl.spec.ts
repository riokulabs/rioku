// Use the plain `test` rather than `authedPage`: the latter's
// addInitScript clears localStorage on EVERY navigation, which wipes
// the `i18nextLng` value we set below before the reload's
// LanguageDetector reads it. The base test inherits the global
// `use.storageState` so we're still authenticated as root.
import { test, expect } from '@playwright/test';

test('switching to Arabic sets dir="rtl" on html element', async ({ page }) => {
  await page.goto('/t/acme/dashboard');

  // Regression guard for stage-2: the user-menu trigger should be
  // reachable by stable testid (the prior `derrick` text-filter
  // belonged to the stage-1 mock-store).
  await expect(page.getByTestId('user-menu-trigger')).toBeVisible();

  // `react-i18next` initialises locale from the `i18nextLng`
  // localStorage key on boot (via `i18next-browser-languagedetector`).
  // Mantine MenuSub's hover-only trigger flakes in headless render, so
  // we drive the same code path the menu would: write the key and
  // reload. The app's `Providers` sets `dir="rtl"` on <html> for `ar`.
  await page.evaluate(() => {
    localStorage.setItem('i18nextLng', 'ar');
  });
  await page.reload();
  await page.waitForLoadState('networkidle');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 5_000 });
});
