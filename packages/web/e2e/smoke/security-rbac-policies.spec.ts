/**
 * E2E smoke tests for the Security RBAC Policies page — Task 9c.8 gap fill.
 *
 * Coverage:
 *   - Seeded RBAC policies render on /t/acme/security/rbac-policies.
 *   - Row click opens the policy detail drawer.
 *   - Create policy button opens the editor drawer.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('seeded RBAC policies render on /t/acme/security/rbac-policies', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/rbac-policies');

  await expect(
    page.getByRole('heading', { name: /^rbac policies$/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /create policy/i }),
  ).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('row click opens RBAC policy detail drawer', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/rbac-policies');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
});

test('create policy button opens RBAC editor drawer', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/rbac-policies');

  await page.getByRole('button', { name: /create policy/i }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('textbox', { name: /^name$/i })).toBeVisible();
});
