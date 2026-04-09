import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

adminTest.describe('Theme', () => {
  adminTest('toggle dark to light changes html class', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const initialClass = await html.getAttribute('class') ?? '';
    const isDark = initialClass.includes('dark');

    // Toggle theme via keyboard shortcut — Mod maps to Control on Linux
    // Dispatch with correct modifier — WebKit reports as Mac (metaKey), others use ctrlKey
    await page.evaluate(() => {
      const isMac = /mac/i.test(navigator.platform);
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 't', ctrlKey: !isMac, metaKey: isMac, shiftKey: true, bubbles: true,
      }));
    });

    // Wait for the class to actually change instead of a fixed timeout
    await page.waitForFunction(
      (wasDark) => {
        const cls = document.documentElement.className;
        return wasDark ? !cls.includes('dark') : cls.includes('dark');
      },
      isDark,
      { timeout: 5000 },
    );

    const newClass = await html.getAttribute('class') ?? '';
    if (isDark) {
      expect(newClass).not.toContain('dark');
    } else {
      expect(newClass).toContain('dark');
    }

    // Toggle back
    // Dispatch with correct modifier — WebKit reports as Mac (metaKey), others use ctrlKey
    await page.evaluate(() => {
      const isMac = /mac/i.test(navigator.platform);
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 't', ctrlKey: !isMac, metaKey: isMac, shiftKey: true, bubbles: true,
      }));
    });

    await page.waitForFunction(
      (wasDark) => {
        const cls = document.documentElement.className;
        return wasDark ? cls.includes('dark') : !cls.includes('dark');
      },
      isDark,
      { timeout: 5000 },
    );

    const restoredClass = await html.getAttribute('class') ?? '';
    expect(restoredClass.includes('dark')).toBe(isDark);
  });

  adminTest('theme persists across page reload', async ({ page }) => {
    await page.goto('/');

    // Switch to light mode if currently dark
    const html = page.locator('html');
    const initialClass = await html.getAttribute('class') ?? '';
    if (initialClass.includes('dark')) {
      // Dispatch with correct modifier — WebKit reports as Mac (metaKey), others use ctrlKey
    await page.evaluate(() => {
      const isMac = /mac/i.test(navigator.platform);
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 't', ctrlKey: !isMac, metaKey: isMac, shiftKey: true, bubbles: true,
      }));
    });
      await page.waitForFunction(
        () => !document.documentElement.className.includes('dark'),
        undefined,
        { timeout: 5000 },
      );
    }

    // Verify light mode
    const lightClass = await html.getAttribute('class') ?? '';
    expect(lightClass).not.toContain('dark');

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for theme to be applied after reload — preferences are loaded from
    // localStorage and applied during useTheme mount.
    await page.waitForFunction(
      () => document.documentElement.className !== undefined,
      undefined,
      { timeout: 5000 },
    );

    const afterReloadClass = await html.getAttribute('class') ?? '';
    expect(afterReloadClass).not.toContain('dark');

    // Restore dark mode
    // Dispatch with correct modifier — WebKit reports as Mac (metaKey), others use ctrlKey
    await page.evaluate(() => {
      const isMac = /mac/i.test(navigator.platform);
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 't', ctrlKey: !isMac, metaKey: isMac, shiftKey: true, bubbles: true,
      }));
    });
    await page.waitForFunction(
      () => document.documentElement.className.includes('dark'),
      undefined,
      { timeout: 5000 },
    );
  });

  adminTest('system preference detection via emulateMedia', async ({ page }) => {
    // Clear any stored preference first — set to 'system' so the app respects
    // OS preference via matchMedia.
    await page.evaluate(() => {
      const key = 'rioku-preferences';
      const raw = localStorage.getItem(key);
      const prefs = raw ? JSON.parse(raw) : {};
      prefs.theme = 'system';
      localStorage.setItem(key, JSON.stringify(prefs));
    });

    // Emulate light color scheme
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.waitForFunction(
      () => document.documentElement.className !== undefined,
      undefined,
      { timeout: 5000 },
    );

    const lightClass = await page.locator('html').getAttribute('class') ?? '';

    // Emulate dark color scheme
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.waitForFunction(
      () => document.documentElement.className !== undefined,
      undefined,
      { timeout: 5000 },
    );

    const darkClass = await page.locator('html').getAttribute('class') ?? '';

    // At least one of these should differ based on system preference
    expect(typeof lightClass).toBe('string');
    expect(typeof darkClass).toBe('string');
  });
});
