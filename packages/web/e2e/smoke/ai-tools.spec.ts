/**
 * E2E smoke tests for the AI Tools page — Task 9c.8 gap fill.
 *
 * Coverage:
 *   - Seeded tools render on /t/acme/ai/tools.
 *   - Row click opens the tool detail drawer.
 *   - "New tool" button opens the create drawer.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('seeded AI tools render on /t/acme/ai/tools', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/ai/tools');

  await expect(
    page.getByRole('heading', { name: /^ai tools$/i }),
  ).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('row click opens AI tool detail drawer', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/ai/tools');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
});

test('new tool button opens create drawer', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/ai/tools');

  await page.getByRole('button', { name: /new tool/i }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('textbox', { name: /^name$/i })).toBeVisible();
});
