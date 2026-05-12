/**
 * Sidebar collapse — verifies the rail collapse toggle works.
 *
 * Stage-2 moved the desktop collapse trigger from a top-bar burger
 * into the sidebar rail itself. The toggle is the `UnstyledButton`
 * with `data-testid="sidebar-collapse-toggle"`. The rail signals its
 * state via `data-collapsed` + `aria-expanded` on the rail container,
 * which is far more deterministic than pixel-geometry assertions on
 * top of a Mantine CSS width transition (the prior version flaked in
 * headless render because the transition runs concurrently with the
 * boundingBox sample).
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('sidebar collapse toggle — state attributes flip on click', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/dashboard');

  const rail = page.getByTestId('sidebar-rail');
  await expect(rail).toBeVisible();

  // Initial state — sidebar starts expanded.
  await expect(rail).toHaveAttribute('data-collapsed', 'false');
  await expect(rail).toHaveAttribute('aria-expanded', 'true');

  // Collapse.
  await page.getByTestId('sidebar-collapse-toggle').click();
  await expect(rail).toHaveAttribute('data-collapsed', 'true');
  await expect(rail).toHaveAttribute('aria-expanded', 'false');

  // Re-expand.
  await page.getByTestId('sidebar-collapse-toggle').click();
  await expect(rail).toHaveAttribute('data-collapsed', 'false');
  await expect(rail).toHaveAttribute('aria-expanded', 'true');
});
