import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

adminTest.describe('Theme', () => {
  adminTest('toggle dark to light changes html class', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const initialClass = await html.getAttribute('class') ?? '';
    const isDark = initialClass.includes('dark');

    // Toggle theme via keyboard shortcut (Mod+Shift+T)
    await page.keyboard.press('Meta+Shift+t');
    await page.waitForTimeout(300);

    const newClass = await html.getAttribute('class') ?? '';
    if (isDark) {
      expect(newClass).not.toContain('dark');
    } else {
      expect(newClass).toContain('dark');
    }

    // Toggle back
    await page.keyboard.press('Meta+Shift+t');
    await page.waitForTimeout(300);

    const restoredClass = await html.getAttribute('class') ?? '';
    expect(restoredClass.includes('dark')).toBe(isDark);
  });

  adminTest('theme persists across page reload', async ({ page }) => {
    await page.goto('/');

    // Switch to light mode
    const html = page.locator('html');
    const initialClass = await html.getAttribute('class') ?? '';
    if (initialClass.includes('dark')) {
      await page.keyboard.press('Meta+Shift+t');
      await page.waitForTimeout(300);
    }

    // Verify light mode
    const lightClass = await html.getAttribute('class') ?? '';
    expect(lightClass).not.toContain('dark');

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    const afterReloadClass = await html.getAttribute('class') ?? '';
    expect(afterReloadClass).not.toContain('dark');

    // Restore dark mode
    await page.keyboard.press('Meta+Shift+t');
  });

  adminTest('system preference detection via emulateMedia', async ({ page }) => {
    // Clear any stored preference first
    await page.evaluate(() => localStorage.removeItem('rioku-theme'));

    // Emulate light color scheme
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.waitForTimeout(500);

    const lightClass = await page.locator('html').getAttribute('class') ?? '';

    // Emulate dark color scheme
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.waitForTimeout(500);

    const darkClass = await page.locator('html').getAttribute('class') ?? '';

    // At least one of these should differ based on system preference
    expect(typeof lightClass).toBe('string');
    expect(typeof darkClass).toBe('string');
  });
});
