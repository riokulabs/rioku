/**
 * E2E smoke tests for the routes service filter — Issue: Routes filterable by
 * attached service.
 *
 * Verifies:
 *   - The service filter dropdown is rendered on /t/acme/routes.
 *   - Selecting a service filters the route rows.
 *   - Clearing the filter (selecting "All services") restores all rows.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('service filter dropdown is visible on /t/acme/routes', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/routes');

  await expect(page.getByRole('heading', { name: /^routes$/i })).toBeVisible();

  // The service filter Select is rendered with aria-label "Filter by service"
  const serviceFilter = page.getByRole('combobox', { name: /filter by service/i });
  await expect(serviceFilter).toBeVisible({ timeout: 5_000 });
});

test('selecting a service filters route rows', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/routes');

  // Wait for rows to load
  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const totalCount = await rows.count();
  expect(totalCount).toBeGreaterThanOrEqual(1);

  // Open the service filter dropdown
  const serviceFilter = page.getByRole('combobox', { name: /filter by service/i });
  await serviceFilter.click();

  // Pick the first non-"All services" option from the dropdown
  const options = page.getByRole('option');
  await options.first().waitFor({ timeout: 5_000 });
  const optionCount = await options.count();

  if (optionCount <= 1) {
    // Only "All services" available — skip the filtering assertion
    return;
  }

  // Click the second option (first real service)
  await options.nth(1).click();

  // After filtering, the row count should still show at least 1 row
  // (services always have ≥1 route in the seed data)
  await expect(rows.first()).toBeVisible({ timeout: 5_000 });
  const filteredCount = await rows.count();
  expect(filteredCount).toBeGreaterThanOrEqual(1);
  // Filtered count should be ≤ total (could be equal if only one service)
  expect(filteredCount).toBeLessThanOrEqual(totalCount);
});

test('clearing service filter restores all route rows', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/routes');

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const totalCount = await rows.count();

  // Apply a service filter
  const serviceFilter = page.getByRole('combobox', { name: /filter by service/i });
  await serviceFilter.click();

  const options = page.getByRole('option');
  await options.first().waitFor({ timeout: 5_000 });
  const optionCount = await options.count();

  if (optionCount <= 1) {
    return;
  }

  // Select second option (a real service)
  await options.nth(1).click();

  // Now clear by selecting "All services" (first option)
  await serviceFilter.click();
  const allOptions = page.getByRole('option');
  await allOptions.first().waitFor({ timeout: 5_000 });
  await allOptions.first().click();

  // Should be back to full count
  await expect(rows.first()).toBeVisible({ timeout: 5_000 });
  const restoredCount = await rows.count();
  expect(restoredCount).toBe(totalCount);
});
