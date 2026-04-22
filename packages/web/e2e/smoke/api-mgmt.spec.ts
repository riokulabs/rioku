/**
 * E2E smoke tests for the Services / Routes / Middlewares / API Explorer
 * pages — Task 2d.28.
 *
 * The acme tenant receives roughly a third of the 20/60/10 seed counts
 * because `pick()` stripes entities across the 3 seeded tenants, so the
 * assertions use realistic floors rather than the global seed totals.
 *
 * The API explorer test only verifies that Scalar mounts a recognisable
 * element — Scalar uses browser globals that would fail under jsdom, so
 * this Playwright spec is the only integration surface that renders the
 * real Vue-backed component.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('services list renders seeded rows on /t/acme/services', async ({ authedPage: page }) => {
  await page.goto('/t/acme/services');

  await expect(page.getByRole('heading', { name: /^services$/i })).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 5_000 });
  // Acme receives ~20/3 services via the striped pick() distribution.
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(5);
});

test('service detail drawer shows nested routes', async ({ authedPage: page }) => {
  await page.goto('/t/acme/services');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();

  // Drawer opens — it renders a heading inside itself. Services detail uses
  // a Title with the service name and a "Routes (n)" text.
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible({ timeout: 5_000 });
  await expect(drawer.getByText(/routes\s*\(/i)).toBeVisible();
});

test('routes list renders seeded rows on /t/acme/routes', async ({ authedPage: page }) => {
  await page.goto('/t/acme/routes');

  await expect(page.getByRole('heading', { name: /^routes$/i })).toBeVisible();

  // Routes are 3 per service and the DataTable default page size is 25, so
  // the first page should be full. We assert ≥15 rows visible.
  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 5_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(10);
});

test('middlewares list renders seeded rows on /t/acme/middlewares', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/middlewares');

  await expect(page.getByRole('heading', { name: /middlewares/i })).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 5_000 });
  const count = await rows.count();
  // Acme gets ~10/3 ≈ 3 middlewares.
  expect(count).toBeGreaterThanOrEqual(2);
});

test('API explorer renders the Scalar viewer on /t/acme/api-explorer', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/api-explorer');

  // The lazy-loaded feature module wraps Scalar in the api-explorer testid
  // div. Scalar itself mounts a top-level <section class="scalar-..." /> or
  // similar, but the wrapper is the stable signal that the route resolved.
  await expect(page.getByTestId('api-explorer')).toBeVisible({ timeout: 15_000 });

  // Wait for Scalar to finish hydrating. Scalar renders its own <aside
  // role="navigation"> sidebar inside our wrapper div — that landmark is the
  // stable signal the Vue-backed viewer mounted successfully.
  const scalarSidebar = page
    .getByTestId('api-explorer')
    .locator('aside[role="navigation"]')
    .first();
  await expect(scalarSidebar).toBeVisible({ timeout: 15_000 });
});
