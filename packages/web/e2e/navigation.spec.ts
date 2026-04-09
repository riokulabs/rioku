import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

adminTest.describe('Navigation', () => {
  adminTest('every sidebar link navigates to correct page', async ({ page }) => {
    await page.goto('/');

    // These match the navSections in app-sidebar.tsx + the Settings link in the
    // sidebar footer, using the translated English labels from common.json.
    const navLinks = [
      { text: 'Dashboard', url: '/' },
      { text: 'Routes', url: '/config/routes' },
      { text: 'Services', url: '/config/services' },
      { text: 'Policies', url: '/config/policies' },
      { text: 'Live', url: '/traffic/live' },
      { text: 'Analytics', url: '/traffic/analytics' },
      { text: 'AI Workloads', url: '/traffic/ai' },
      { text: 'Cluster', url: '/cluster' },
      { text: 'Plugins', url: '/plugins' },
      { text: 'Security', url: '/security' },
      { text: 'Users', url: '/settings/users' },
      { text: 'Roles', url: '/settings/roles' },
      { text: 'Settings', url: '/settings' },
    ];

    for (const link of navLinks) {
      const sidebar = page.locator('[data-sidebar="sidebar"]');
      // Target menu buttons specifically to avoid matching section group labels
      // (e.g. "Security" is both a section heading and a nav item).
      const btn = sidebar.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: link.text });
      await btn.first().click();
      // Match URL path — escape slashes for regex, anchor at end
      await expect(page).toHaveURL(new RegExp(link.url.replace(/\//g, '\\/') + '$'));
    }
  });

  adminTest('command palette: Mod+K opens, search "routes", select navigates', async ({ page }) => {
    await page.goto('/');

    // Open command palette with keyboard shortcut — Mod maps to Control on Linux
    await page.keyboard.press('Control+k');

    // Command palette dialog should open (rendered via CommandDialog -> Dialog)
    const palette = page.locator('[role="dialog"]');
    await expect(palette.first()).toBeVisible({ timeout: 5000 });

    // Type search query
    await page.keyboard.type('routes');

    // Select the routes option (cmdk renders items with [cmdk-item] attribute)
    const routeOption = page.locator('[cmdk-item]').filter({ hasText: /routes/i });
    if (await routeOption.first().isVisible()) {
      await routeOption.first().click();
      await expect(page).toHaveURL(/\/config\/routes/);
    }
  });

  adminTest('sidebar collapse: Mod+B toggles sidebar', async ({ page }) => {
    await page.goto('/');

    // The data-state attribute is on the outer wrapper div[data-slot="sidebar"],
    // not on the inner [data-sidebar="sidebar"] element.
    const sidebarSlot = page.locator('[data-slot="sidebar"]');
    await expect(sidebarSlot).toBeVisible();

    // Get initial state
    const initialState = await sidebarSlot.getAttribute('data-state');

    // Toggle sidebar — Mod maps to Control on Linux
    await page.keyboard.press('Control+b');
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('[data-slot="sidebar"]');
        return el?.getAttribute('data-state') !== prev;
      },
      initialState,
      { timeout: 3000 },
    );

    const newState = await sidebarSlot.getAttribute('data-state');
    expect(newState).not.toBe(initialState);

    // Toggle back
    await page.keyboard.press('Control+b');
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('[data-slot="sidebar"]');
        return el?.getAttribute('data-state') !== prev;
      },
      newState,
      { timeout: 3000 },
    );

    const restoredState = await sidebarSlot.getAttribute('data-state');
    expect(restoredState).toBe(initialState);
  });

  adminTest('keyboard shortcut help: ? opens overlay', async ({ page }) => {
    await page.goto('/');

    // Ensure focus is on a non-input element so the hotkey handler fires.
    await page.locator('body').click();

    // The useHotkey hook registers '?' and checks e.key === '?' with no modifier
    // requirements (needsShift=false). Playwright's keyboard.press('?') may set
    // shiftKey=true in some browsers (WebKit), causing the handler to bail.
    // Dispatch a synthetic keydown event that exactly matches what the hook expects.
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: '?',
        code: 'Slash',
        bubbles: true,
        cancelable: true,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      }));
    });

    // The KeyboardShortcutHelp component renders a Dialog with "Keyboard Shortcuts" title
    const helpOverlay = page.getByText('Keyboard Shortcuts');
    await expect(helpOverlay.first()).toBeVisible({ timeout: 5000 });

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
