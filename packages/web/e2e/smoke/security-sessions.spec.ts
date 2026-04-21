/**
 * E2E smoke tests for the Security Sessions page — Task 9c.8 gap fill.
 *
 * Coverage:
 *   - Sessions page renders on /t/acme/security/sessions.
 *   - Seeded sessions appear in the list.
 *   - Settings link is present.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('sessions page renders on /t/acme/security/sessions', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/sessions');

  await expect(
    page.getByRole('heading', { name: /^sessions$/i }),
  ).toBeVisible();
  // Settings anchor should be present.
  await expect(
    page.getByRole('link', { name: /session timeouts/i }),
  ).toBeVisible();
});

test('seeded sessions render in the list', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/sessions');

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});
