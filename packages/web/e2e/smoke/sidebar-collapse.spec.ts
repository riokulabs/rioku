/**
 * Sidebar collapse screenshots — verifies the desktop collapse toggle works.
 * Saves screenshots to e2e/screenshots/sidebar-collapse-{open,closed}.png.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

const SCREENSHOTS_DIR = new URL('../screenshots/', import.meta.url).pathname;

test('sidebar collapse toggle — screenshot open and closed states', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/dashboard');
  await page.waitForLoadState('networkidle');

  // Screenshot: expanded (default) state.
  await page.screenshot({
    path: `${SCREENSHOTS_DIR}sidebar-collapse-open.png`,
    fullPage: false,
  });

  // Click the desktop burger to collapse the sidebar.
  const desktopBurger = page.getByTestId('topbar-burger-desktop');
  await expect(desktopBurger).toBeVisible();
  await desktopBurger.click();

  // Wait for Mantine's CSS transition to complete.
  await page.waitForTimeout(600);

  // Screenshot: collapsed state.
  await page.screenshot({
    path: `${SCREENSHOTS_DIR}sidebar-collapse-closed.png`,
    fullPage: false,
  });

  // Mantine's AppShell collapses the navbar by translating it off-screen or
  // setting its width to 0 via CSS. The nav element remains in the DOM but
  // its bounding box width should collapse to 0 (or near 0) when closed.
  const sidebar = page.locator('nav[class*="Navbar"], nav[class*="navbar"]').first();
  const box = await sidebar.boundingBox();
  // Allow for the sidebar to be either off-screen (negative x or zero width)
  // or hidden by CSS transform. Accept if width is 0 or element is off-screen.
  const isCollapsed = box === null || box.width <= 0 || box.x < 0;
  expect(isCollapsed, `sidebar should be collapsed (got box: ${JSON.stringify(box)})`).toBe(true);

  // Re-expand and verify it comes back.
  await desktopBurger.click();
  await page.waitForTimeout(600);

  const boxExpanded = await sidebar.boundingBox();
  const isExpanded = boxExpanded !== null && boxExpanded.width > 100;
  expect(
    isExpanded,
    `sidebar should be expanded again (got box: ${JSON.stringify(boxExpanded)})`,
  ).toBe(true);
});
