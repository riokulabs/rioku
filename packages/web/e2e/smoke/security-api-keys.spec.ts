/**
 * E2E smoke tests for the Security API Keys page — Task 9c.8 gap fill.
 *
 * Coverage:
 *   - Seeded API keys render on /t/acme/security/api-keys.
 *   - Create key button opens the create drawer.
 *   - Row click opens the key detail drawer.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('seeded API keys render on /t/acme/security/api-keys', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/api-keys');

  await expect(
    page.getByRole('heading', { name: /^api keys$/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /create key/i }),
  ).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('create key button opens create drawer', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/api-keys');

  await page.getByRole('button', { name: /create key/i }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  // The create drawer should contain a name field.
  await expect(drawer.getByRole('textbox', { name: /^name$/i })).toBeVisible();
});

test('row click opens API key detail drawer', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/api-keys');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
});
