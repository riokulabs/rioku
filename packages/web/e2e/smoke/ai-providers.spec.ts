/**
 * E2E smoke tests for the AI Providers page — Task 3e.23.
 *
 * Coverage:
 *   - Seeded providers render in the list for the acme tenant.
 *   - Detail drawer opens; rotate-credential modal writes a new prefix chip.
 *   - Add-model form appends a row to the ModelManager table.
 *   - Test-connection fires and surfaces a result badge (success or error —
 *     either outcome is valid under the mock-latency harness).
 *
 * Row-count floor is ≥1 rather than the spec's "≥4" because `pick()` stripes
 * providers across the 3 seeded tenants, so acme only receives ~⅓ of the 4
 * global provider seeds. The important signal is that the list hydrates and
 * at least one seeded provider is visible.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

function uniqueModelAlias(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return `e2e-model-${String(Date.now())}-${String(n)}`;
}

test('seeded providers render on /t/acme/ai/providers', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/ai/providers');

  await expect(page.getByRole('heading', { name: /^ai providers$/i })).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('rotate credential updates the prefix chip', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/ai/providers');

  // Open the first provider detail drawer.
  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  // Capture the current credential prefix badge text. The drawer renders the
  // prefix as "<prefix>…" (U+2026 ellipsis) inside a Mantine Badge; it's the
  // only drawer text ending with a literal ellipsis character.
  const chip = drawer.locator('text=/…$/').first();
  await expect(chip).toBeVisible();
  const original = (await chip.textContent()) ?? '';
  expect(original.length).toBeGreaterThan(1);

  // Click Rotate, submit a new credential.
  await drawer.getByRole('button', { name: /^rotate$/i }).click();
  const modal = page.getByRole('dialog', { name: /rotate credential/i });
  await expect(modal).toBeVisible();
  // Use a distinctive prefix so the chip change is detectable.
  const newCred = `e2e-rot-${String(Date.now())}-pref0000000`;
  // The PasswordInput has no explicit label — target by placeholder to scope
  // inside the modal. Focus explicitly before filling so React's controlled
  // state reliably picks up the change and enables the submit button.
  const credInput = modal.getByPlaceholder('sk-…');
  await credInput.click();
  await credInput.fill(newCred);
  const submit = modal.getByRole('button', { name: /^rotate$/i });
  await expect(submit).toBeEnabled({ timeout: 5_000 });
  await submit.click();

  // Chip updates — the prefix derives from the leading characters of the
  // credential. Assert it changed and contains the rotation sentinel.
  await expect(chip).not.toHaveText(original, { timeout: 5_000 });
  await expect(chip).toContainText('e2e-rot-');
});

test('add a model via ModelManager appends a row', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/ai/providers');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  // Open the "Add model" collapse.
  await drawer.getByRole('button', { name: /^add model$/i }).click();

  const alias = uniqueModelAlias();
  await drawer.getByRole('textbox', { name: /^upstream id$/i }).fill(`upstream-${alias}`);
  await drawer.getByRole('textbox', { name: /^alias$/i }).fill(alias);

  // Submit form (button labelled "Add model" inside the form — scope to the
  // submit button by type).
  await drawer.locator('button[type="submit"]').filter({ hasText: /add model/i }).click();

  // New row should appear in the models table.
  await expect(drawer.getByText(alias, { exact: false }).first()).toBeVisible({
    timeout: 5_000,
  });
});

test('test connection shows a result badge', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/ai/providers');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  // Click "Test connection".
  await drawer.getByRole('button', { name: /test connection/i }).click();

  // Either OK or FAIL badge is acceptable — the mock-failure harness flips a
  // coin; we only care that the request ran and a result surfaced.
  const badge = drawer.locator('text=/^(OK|FAIL)\\s*·/').first();
  await expect(badge).toBeVisible({ timeout: 10_000 });
});
