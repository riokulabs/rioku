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

  // Initial state is whatever localStorage holds — capture and flip
  // twice, so the test verifies the toggle is the only thing that
  // changes the attributes regardless of which state we start in.
  const initial = await rail.getAttribute('data-collapsed');
  const initialBool = initial === 'true';

  await page.getByTestId('sidebar-collapse-toggle').click();
  await expect(rail).toHaveAttribute('data-collapsed', String(!initialBool));
  await expect(rail).toHaveAttribute('aria-expanded', String(initialBool));

  await page.getByTestId('sidebar-collapse-toggle').click();
  await expect(rail).toHaveAttribute('data-collapsed', String(initialBool));
  await expect(rail).toHaveAttribute('aria-expanded', String(!initialBool));
});
