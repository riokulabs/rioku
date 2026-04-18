import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from '../axe';

test('app shell renders', async ({ page }) => {
  await page.goto('/t/acme/dashboard');

  // Dashboard heading
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

  // Tenant pill in sidebar footer shows "acme"
  await expect(page.getByText('acme').first()).toBeVisible();

  // Notifications button in top bar
  await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible();

  // No serious a11y violations
  await expectNoA11yViolations(page);
});

test('spotlight opens via mod+K', async ({ page }) => {
  await page.goto('/t/acme/dashboard');

  // Press Ctrl+K (mod+K maps to Ctrl+K on Linux in Playwright)
  await page.keyboard.press('Control+K');

  // Mantine Spotlight renders a search input with placeholder "Search..."
  await expect(page.getByPlaceholder(/search/i)).toBeVisible();
});

test('keyboard shortcuts overlay opens via ?', async ({ page }) => {
  await page.goto('/t/acme/dashboard');

  // Click body to ensure focus is on the document (not an input).
  // Mantine useHotkeys listens on document and filters out input/textarea/select.
  await page.locator('body').click();

  // Type '?' — Playwright types it as a character, triggering a keydown with key='?'
  // which is what Mantine useHotkeys listens for.
  await page.keyboard.type('?');

  // The KeyboardShortcutsHelp modal should appear
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/keyboard shortcuts/i)).toBeVisible();
});
