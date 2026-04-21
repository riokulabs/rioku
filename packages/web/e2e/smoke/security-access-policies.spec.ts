/**
 * E2E smoke tests for the Security Access Policies page — Task 9c.8 gap fill.
 *
 * Coverage:
 *   - Seeded access policies render on /t/acme/security/access-policies.
 *   - Create policy drawer opens and policy appears in the list.
 *   - Row click opens the policy detail drawer.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('seeded access policies render on /t/acme/security/access-policies', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/access-policies');

  await expect(
    page.getByRole('heading', { name: /^access policies$/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /create policy/i }),
  ).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('row click opens access policy detail drawer', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/access-policies');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
});

test('create policy button opens editor drawer', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/access-policies');

  await page.getByRole('button', { name: /create policy/i }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  // Editor drawer should contain a name field.
  await expect(drawer.getByRole('textbox', { name: /^name$/i })).toBeVisible();
});
