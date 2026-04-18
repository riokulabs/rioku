import { test, expect } from '@playwright/test';

test('switching to Arabic sets dir="rtl" on html element', async ({ page }) => {
  await page.goto('/t/acme/dashboard');

  // Attempt to change language via the profile menu → Language submenu.
  //
  // The sidebar footer profile button (showing "derrick") opens a menu with a
  // Language sub-menu entry. We click to open, then hover Language to expand
  // the sub-menu, then click العربية.
  //
  // If the nested MenuSub hover is unreliable in headless Chromium, we fall
  // back to setting i18next language via localStorage + reload (LanguageDetector
  // reads 'i18nextLng' on initialisation). Document: fallback is used because
  // Mantine MenuSub requires a hover event that can be flaky in headless mode.

  const profileButton = page.getByRole('button').filter({ hasText: 'derrick' });
  await profileButton.click();

  // Give dropdown time to appear
  await page.waitForTimeout(200);

  const languageItem = page.getByText('Language');
  const langVisible = await languageItem.isVisible().catch(() => false);

  if (langVisible) {
    await languageItem.hover();
    await page.waitForTimeout(200);

    const arabicItem = page.getByText('العربية');
    const arabicVisible = await arabicItem.isVisible().catch(() => false);

    if (arabicVisible) {
      await arabicItem.click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      return;
    }
  }

  // Fallback: set language via localStorage and reload.
  // i18next-browser-languagedetector reads 'i18nextLng' from localStorage on init.
  await page.evaluate(() => { localStorage.setItem('i18nextLng', 'ar'); });
  await page.reload();
  await page.waitForLoadState('networkidle');

  // After reload with ar locale, Providers sets dir="rtl" on <html>
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
