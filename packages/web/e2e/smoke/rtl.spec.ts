import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('switching to Arabic sets dir="rtl" on html element', async ({ authedPage: page }) => {
  await page.goto('/t/acme/dashboard');

  // Open the sidebar user menu via its stable testid. The previous version
  // of this spec targeted a hard-coded `derrick` profile button that only
  // existed on the stage-1 mock-store; stage-2 logs in as `root`, so the
  // menu trigger now carries `data-testid="user-menu-trigger"` instead.
  await page.getByTestId('user-menu-trigger').click();

  // Hover the Language sub-menu so its children mount, then click the
  // Arabic option by stable testid (Mantine renders language strings
  // localised, so matching by text would break if the active locale
  // already differs).
  const languageItem = page.getByRole('menuitem', { name: /^language$/i });
  await expect(languageItem).toBeVisible({ timeout: 5_000 });
  await languageItem.hover();

  const arabicItem = page.getByTestId('language-option-ar');
  await expect(arabicItem).toBeVisible({ timeout: 5_000 });
  await arabicItem.click();

  // i18next + React-i18next sets `dir="rtl"` on <html> for `ar` via the
  // app's `Providers` component. Wait up to a tick for the attribute
  // update to land.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 5_000 });
});
