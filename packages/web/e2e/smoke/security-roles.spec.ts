/**
 * E2E smoke tests for the Security Roles page — Task 9c.8 gap fill.
 *
 * Coverage:
 *   - Seeded roles render on /t/acme/security/roles.
 *   - Create role drawer opens and creates a new role that appears in the list.
 *   - Row click opens the detail drawer.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('seeded roles render on /t/acme/security/roles', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/roles');

  await expect(page.getByRole('heading', { name: /^roles$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /create role/i })).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('create role drawer opens and role appears in list', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/roles');

  const roleName = `e2e-role-${String(Date.now())}`;

  await page.getByRole('button', { name: /create role/i }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  await drawer.getByRole('textbox', { name: /^name$/i }).fill(roleName);
  await drawer.getByRole('button', { name: /^create role$/i }).click();

  // After save the drawer closes and the new role row is in the list.
  await expect(
    page.getByText(roleName, { exact: false }).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test('row click opens role detail drawer', async ({ authedPage: page }) => {
  await page.goto('/t/acme/security/roles');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
});
