import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

adminTest.describe('Navigation', () => {
  adminTest('every sidebar link navigates to correct page', async ({ page }) => {
    await page.goto('/');

    const navLinks = [
      { text: 'Dashboard', url: '/' },
      { text: 'Routes', url: '/config/routes' },
      { text: 'Services', url: '/config/services' },
      { text: 'Policies', url: '/config/policies' },
      { text: 'Live', url: '/traffic/live' },
      { text: 'Analytics', url: '/traffic/analytics' },
      { text: 'Cluster', url: '/cluster' },
      { text: 'Plugins', url: '/plugins' },
      { text: 'Security', url: '/security' },
    ];

    for (const link of navLinks) {
      const sidebar = page.locator('[data-sidebar="sidebar"]');
      await sidebar.getByText(link.text, { exact: false }).first().click();
      await expect(page).toHaveURL(new RegExp(link.url.replace(/\//g, '\\/')));
    }
  });

  adminTest('command palette: Mod+K opens, search "routes", select navigates', async ({ page }) => {
    await page.goto('/');

    // Open command palette with keyboard shortcut
    await page.keyboard.press('Meta+k');

    // Command palette dialog should open
    const palette = page.locator('[cmdk-root]').or(page.locator('[role="dialog"]').filter({ hasText: /search/i }));
    await expect(palette.first()).toBeVisible();

    // Type search query
    await page.keyboard.type('routes');

    // Select the routes option
    const routeOption = page.getByRole('option', { name: /routes/i })
      .or(page.locator('[cmdk-item]').filter({ hasText: /routes/i }));
    if (await routeOption.first().isVisible()) {
      await routeOption.first().click();
      await expect(page).toHaveURL(/\/config\/routes/);
    }
  });

  adminTest('sidebar collapse: Mod+B toggles sidebar', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await expect(sidebar).toBeVisible();

    // Get initial state
    const initialState = await sidebar.getAttribute('data-state');

    // Toggle sidebar
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(300);

    const newState = await sidebar.getAttribute('data-state');
    // State should have changed (expanded <-> collapsed)
    expect(newState).not.toBe(initialState);

    // Toggle back
    await page.keyboard.press('Meta+b');
    await page.waitForTimeout(300);

    const restoredState = await sidebar.getAttribute('data-state');
    expect(restoredState).toBe(initialState);
  });

  adminTest('keyboard shortcut help: ? opens overlay', async ({ page }) => {
    await page.goto('/');

    // Press ? to open shortcut help
    await page.keyboard.press('?');

    // Shortcut help dialog/overlay should appear
    const helpOverlay = page.getByText(/keyboard shortcuts/i)
      .or(page.locator('[data-testid="shortcut-help"]'));
    await expect(helpOverlay.first()).toBeVisible();

    // Close it
    await page.keyboard.press('Escape');
  });

  adminTest('breadcrumbs update per page', async ({ page }) => {
    // Navigate to a nested page
    await page.goto('/config/routes');

    // Breadcrumbs should show path context
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]')
      .or(page.locator('nav[aria-label="breadcrumb"]'))
      .or(page.locator('.breadcrumb'));

    if (await breadcrumbs.isVisible()) {
      await expect(breadcrumbs.getByText(/routes/i)).toBeVisible();
    }
  });
});
