/**
 * E2E smoke tests for the Cluster section — Plan 10 (#83).
 *
 * Coverage:
 *   - /t/acme/cluster/nodes lists the four seeded cluster nodes.
 *   - Clicking a row's "Open" link routes to the full-page detail.
 *   - The detail page renders the three-tab UI (Overview / Metrics / Audit)
 *     and the Metrics tab surfaces the PromQL query cards.
 *   - On the enrollment-tokens page, generating a token, then revoking it,
 *     and finally toggling "show consumed" surfaces non-active tokens.
 *
 * The spec is sandbox-aware: it runs against the in-browser mock store seeded
 * by `seedStore` on page load. Stage-2 will extend this against the live
 * daemon by switching VITE_USE_MOCKS=false, at which point the same seeded
 * topology is provided by `sandbox/seed/cluster_nodes.yaml`.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test.describe('cluster flow @isolated', () => {
  test('nodes list shows all four seeded cluster nodes', async ({ authedPage: page }) => {
    await page.goto('/t/acme/cluster/nodes');
    await expect(page.getByRole('heading', { name: /^cluster nodes$/i })).toBeVisible();

    // Four data rows under the table body.
    const rows = page.locator('tbody tr[role="row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    await expect(rows).toHaveCount(4);

    // Names from the sandbox seed.
    await expect(page.getByText('node-primary-1')).toBeVisible();
    await expect(page.getByText('node-replica-1')).toBeVisible();
    await expect(page.getByText('node-replica-2')).toBeVisible();
    await expect(page.getByText('node-witness-1')).toBeVisible();

    // Stat cards — four of them.
    await expect(page.getByTestId('stat-total-nodes')).toBeVisible();
    await expect(page.getByTestId('stat-healthy')).toBeVisible();
    await expect(page.getByTestId('stat-version-distribution')).toBeVisible();
    await expect(page.getByTestId('stat-p95-latency')).toBeVisible();
  });

  test('node detail tabs render and Metrics tab shows PromQL cards', async ({
    authedPage: page,
  }) => {
    await page.goto('/t/acme/cluster/nodes');
    await page.locator('tbody tr[role="row"]').first().waitFor({ timeout: 10_000 });

    // Click the first row's "Open" button to navigate to the detail page.
    await page
      .getByRole('link', { name: /^open$/i })
      .first()
      .click();

    // Three tabs.
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /metrics/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /audit/i })).toBeVisible();

    // Switch to Metrics — five PromQL cards render.
    await page.getByRole('tab', { name: /metrics/i }).click();
    await expect(page.getByTestId('node-metric-card-cpu')).toBeVisible();
    await expect(page.getByTestId('node-metric-card-memory')).toBeVisible();
    await expect(page.getByTestId('node-metric-card-rps')).toBeVisible();
    await expect(page.getByTestId('node-metric-card-errors')).toBeVisible();
    await expect(page.getByTestId('node-metric-card-p95')).toBeVisible();
  });

  test('generate token, revoke it, then toggle show consumed', async ({ authedPage: page }) => {
    await page.goto('/t/acme/cluster/enrollment-tokens');
    await expect(page.getByRole('heading', { name: /^enrollment tokens$/i })).toBeVisible();

    // Default view: only active tokens. Count rows.
    const rows = page.locator('tbody tr[role="row"]');
    await rows.first().waitFor({ timeout: 10_000 });
    const initial = await rows.count();
    expect(initial).toBeGreaterThanOrEqual(1);

    // Generate a new token.
    await page.getByRole('button', { name: /generate token/i }).click();
    // The enroll modal exposes a confirm/generate button — click it.
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    const confirmButton = modal
      .getByRole('button', { name: /^generate$|^confirm$|^create$/i })
      .first();
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
    }
    // Close the modal if still open.
    const closeBtn = modal.getByRole('button', { name: /^(close|done|dismiss)$/i }).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    // Revoke the first active token.
    const firstRevoke = page.getByLabel(/revoke enrollment token/i).first();
    await firstRevoke.click();

    // Toggle "show consumed" — consumed/expired rows now render.
    await page.getByTestId('show-consumed-toggle').click();

    // After toggle, expect at least one row whose data-state attr is consumed
    // (the seed includes a consumed token).
    const consumedRows = page.locator('tr[role="row"][data-state="consumed"]');
    await expect(consumedRows.first()).toBeVisible({ timeout: 5_000 });
  });
});
