/**
 * Visual regression + scrollbar-leak test for the API Explorer theme fix.
 *
 * Verifies two things fixed in this commit:
 *   1. Scalar's color scheme matches the admin panel's active theme (dark/light).
 *   2. After navigating AWAY from the explorer, the scrollbar styles are reset
 *      and do not persist as a dark leaked style.
 *
 * Screenshots are saved to e2e/screenshots/api-explorer/ for human review
 * (directory is git-ignored).
 */
import { test, expect, type Page } from '@playwright/test';

const SCREENSHOTS_DIR = new URL('../screenshots/api-explorer', import.meta.url)
  .pathname;

/** Set theme via localStorage before the page hydrates. */
async function setTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.addInitScript((t: string) => {
    localStorage.clear();
    localStorage.setItem('rioku-active-theme', t);
  }, theme);
}

/** Wait for the mock store to be seeded (session ready). */
async function waitForSeed(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const store = (
        window as unknown as {
          __RIOKU_STORE?: {
            getState: () => { currentUserId: string | null };
          };
        }
      ).__RIOKU_STORE;
      if (!store) return false;
      return store.getState().currentUserId !== null;
    },
    null,
    { timeout: 15_000 },
  );
}

/** Read the computed scrollbar-color on <html> via the CSSOM. */
async function getScrollbarColor(page: Page): Promise<string> {
  return page.evaluate(
    () => window.getComputedStyle(document.documentElement).scrollbarColor || '',
  );
}

/** Read the inline style scrollbarColor set directly on <html>. */
async function getInlineScrollbarColor(page: Page): Promise<string> {
  return page.evaluate(
    () => document.documentElement.style.scrollbarColor,
  );
}

/** Read the inline style scrollbarWidth set directly on <html>. */
async function getInlineScrollbarWidth(page: Page): Promise<string> {
  return page.evaluate(
    () => document.documentElement.style.scrollbarWidth,
  );
}

// ---------------------------------------------------------------------------
// Test: dark mode — Scalar should use a dark theme
// ---------------------------------------------------------------------------

test('API Explorer uses dark background in dark mode', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await setTheme(page, 'dark');
  await page.goto('/t/acme/api-explorer');
  await waitForSeed(page);

  // Wait for the explorer container to be visible.
  const container = page.locator('[data-testid="api-explorer"]');
  await expect(container).toBeVisible({ timeout: 20_000 });

  // Verify the Mantine dark-scheme attribute is applied to <html>.
  await expect(page.locator('html')).toHaveAttribute(
    'data-mantine-color-scheme',
    'dark',
  );

  // Capture dark-mode screenshot for human review.
  await page.screenshot({
    path: `${SCREENSHOTS_DIR}/dark.png`,
    fullPage: true,
  });
  console.log('[api-explorer-theme] dark screenshot saved');

  const actionable = consoleErrors.filter(
    (e) =>
      !e.includes('ResizeObserver loop') &&
      !e.includes('[vite]') &&
      !e.includes('WebSocket') &&
      !e.includes('i18next') &&
      !e.includes('favicon'),
  );
  expect(
    actionable,
    `Console errors in dark mode:\n${actionable.join('\n')}`,
  ).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test: light mode — Scalar should switch to a light theme
// ---------------------------------------------------------------------------

test('API Explorer uses light background in light mode', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await setTheme(page, 'light');
  await page.goto('/t/acme/api-explorer');
  await waitForSeed(page);

  const container = page.locator('[data-testid="api-explorer"]');
  await expect(container).toBeVisible({ timeout: 20_000 });

  // Verify the Mantine light-scheme attribute is applied to <html>.
  await expect(page.locator('html')).toHaveAttribute(
    'data-mantine-color-scheme',
    'light',
  );

  // The CSS body background in light mode should NOT be a near-black colour.
  // We check the computed background of the explorer's outer wrapper.
  const bgColor: string = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="api-explorer"]');
    if (!el) return '';
    return window.getComputedStyle(el).backgroundColor;
  });
  // rgb(0,0,0) or very dark rgb values would indicate the light-mode fix failed.
  const isDarkBg = /^rgb\(\s*[0-2]\d?,/.test(bgColor);
  expect(
    isDarkBg,
    `Explorer background '${bgColor}' looks dark in light mode — darkMode prop may not be wired`,
  ).toBe(false);

  // Capture light-mode screenshot.
  await page.screenshot({
    path: `${SCREENSHOTS_DIR}/light.png`,
    fullPage: true,
  });
  console.log('[api-explorer-theme] light screenshot saved');

  const actionable = consoleErrors.filter(
    (e) =>
      !e.includes('ResizeObserver loop') &&
      !e.includes('[vite]') &&
      !e.includes('WebSocket') &&
      !e.includes('i18next') &&
      !e.includes('favicon'),
  );
  expect(
    actionable,
    `Console errors in light mode:\n${actionable.join('\n')}`,
  ).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test: scrollbar styles do not leak after navigating away from the explorer
// ---------------------------------------------------------------------------

test('Scrollbar styles reset after navigating away from API Explorer', async ({ page }) => {
  await setTheme(page, 'dark');
  await page.goto('/t/acme/api-explorer');
  await waitForSeed(page);

  const container = page.locator('[data-testid="api-explorer"]');
  await expect(container).toBeVisible({ timeout: 20_000 });

  // Navigate away to the services page.
  await page.goto('/t/acme/services');

  // Wait for the services page to be visible (explorer has unmounted).
  await expect(
    page.getByRole('heading', { name: /^services$/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Capture after-navigation screenshot.
  await page.screenshot({
    path: `${SCREENSHOTS_DIR}/after-nav.png`,
    fullPage: false,
  });
  console.log('[api-explorer-theme] after-nav screenshot saved');

  // Assert: the inline scrollbar styles on <html> have been cleared by the
  // useEffect cleanup in <ApiExplorer>.
  const inlineScrollbarColor = await getInlineScrollbarColor(page);
  const inlineScrollbarWidth = await getInlineScrollbarWidth(page);

  expect(
    inlineScrollbarColor,
    'Expected scrollbarColor inline style on <html> to be cleared after navigation',
  ).toBe('');

  expect(
    inlineScrollbarWidth,
    'Expected scrollbarWidth inline style on <html> to be cleared after navigation',
  ).toBe('');

  // Also verify that the computed scrollbar-color is no longer a dark/custom
  // value — 'auto' or '' means the browser uses its default.
  const computedScrollbarColor = await getScrollbarColor(page);
  const isLeakedDark =
    computedScrollbarColor !== '' &&
    computedScrollbarColor !== 'auto' &&
    /^rgb\(\s*[0-4]\d?,/.test(computedScrollbarColor);
  expect(
    isLeakedDark,
    `Computed scrollbar-color '${computedScrollbarColor}' looks like a leaked dark style after navigation`,
  ).toBe(false);
});
