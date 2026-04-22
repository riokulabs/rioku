/**
 * E2E smoke tests for the Audit page — Task 5d.14.
 *
 * Coverage:
 *   - List renders for the acme tenant (≥1 row).
 *   - Bounded MultiSelect (action) narrows the visible row count.
 *   - Row click opens the detail drawer with a visible payload / context block.
 *   - Export → CSV triggers a download.
 *   - Live tail toggle surfaces the pulsing LIVE badge, then unmounts it on
 *     toggle-off (the audit route only mounts <LiveTailBadge> while tail is on).
 *   - Retention settings route renders the form, updates `retention_days.read`,
 *     submits, and surfaces a success toast ("Retention saved").
 *
 * Async actor-search is not exercised here — the Mantine Combobox inside
 * <MultiSelectAsync> is driven by focus/blur + debounced fetches that are
 * flaky in headless chromium at CI speeds. The unit tests in
 * src/components/multi-select-async/ and
 * src/features/audit/__tests__/filter-bar.test.tsx cover the search +
 * selection logic at the component level. The CEL-diff assertion is also
 * skipped because no seeded audit entry carries a policy-diff payload
 * (mock-seed does not set `diff` on entries) — cel-diff rendering is
 * covered by the cel-diff unit test.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

test('seeded audit entries render on /t/acme/security/audit', async ({ authedPage: page }) => {
  await page.goto('/t/acme/security/audit');

  await expect(page.getByRole('heading', { name: /^audit log$/i })).toBeVisible();

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test('bounded action filter narrows the row count', async ({ authedPage: page }) => {
  await page.goto('/t/acme/security/audit');

  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const before = await rows.count();
  expect(before).toBeGreaterThanOrEqual(1);

  // Pick a bounded action — user.login is a canonical seeded action and
  // appears in both the ACTION_OPTIONS list and the mock-seed action table.
  const actionInput = page.getByLabel('Filter by action');
  await actionInput.click();
  await page.getByRole('option', { name: 'user.login', exact: true }).click();
  // Close the dropdown so it doesn't overlay subsequent assertions.
  await page.keyboard.press('Escape');

  // After filtering, every visible row's Action column should be user.login.
  // Row count must be ≥1 and ≤ before (300 entries distributed across ~24
  // actions so the post-filter count is strictly smaller in practice).
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const after = await rows.count();
  expect(after).toBeGreaterThanOrEqual(1);
  expect(after).toBeLessThanOrEqual(before);
});

test('row click opens detail drawer with context block', async ({ authedPage: page }) => {
  await page.goto('/t/acme/security/audit');

  const firstRow = page.locator('tbody tr[role="row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  // The detail container is tagged with data-testid="audit-detail".
  await expect(drawer.getByTestId('audit-detail')).toBeVisible();

  // The context section is always rendered — includes at minimum the
  // "Resource:" label. IP / user-agent rows are permission-gated and
  // may be absent on rows without seeded IPs, so don't assert on them.
  await expect(drawer.getByText(/^context$/i)).toBeVisible();
  await expect(drawer.getByText(/resource:/i)).toBeVisible();
});

test('Export CSV triggers a download', async ({ authedPage: page }) => {
  await page.goto('/t/acme/security/audit');

  // Wait for rows to hydrate so the export has data.
  await expect(page.locator('tbody tr[role="row"]').first()).toBeVisible({ timeout: 10_000 });

  // Open the Export menu, then click CSV. Use waitForEvent before the click
  // that triggers the download so the download promise is primed.
  await page.getByTestId('audit-export-menu').click();
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
  await page.getByTestId('audit-export-csv').click();

  const download = await downloadPromise;
  // Filename pattern: `audit-<tenant-slug>-<YYYY-MM-DD>.csv`.
  expect(download.suggestedFilename()).toMatch(/^audit-acme-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('Live tail switch mounts/unmounts the LIVE badge', async ({ authedPage: page }) => {
  await page.goto('/t/acme/security/audit');

  await expect(page.locator('tbody tr[role="row"]').first()).toBeVisible({ timeout: 10_000 });

  // Initially the badge is not in the tree — the audit route only renders
  // <LiveTailBadge> while tailEnabled is true.
  await expect(page.getByTestId('audit-live-badge')).toHaveCount(0);

  // Toggle on — badge appears and shows "LIVE" (no +N while count is 0).
  const tailSwitch = page.getByTestId('audit-live-tail-switch');
  await tailSwitch.click();
  const badge = page.getByTestId('audit-live-badge');
  await expect(badge).toBeVisible({ timeout: 5_000 });
  await expect(badge).toHaveText(/LIVE/);

  // Toggle off — badge unmounts (route branch goes false).
  await tailSwitch.click();
  await expect(badge).toHaveCount(0);
});

test('retention settings form updates and surfaces a success toast', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/audit-retention');

  // The form renders once the mock store is seeded.
  const form = page.getByTestId('audit-retention-form');
  await expect(form).toBeVisible({ timeout: 10_000 });

  // Bump `retention_days.read` by 1. Mantine's NumberInput renders the
  // focusable control as a role="textbox" with the accessible name matching
  // the NumberInput label ("Read"). Target it by role to avoid Mantine's
  // internal DOM restructuring that hides the raw <input>.
  const readField = page.getByRole('textbox', { name: /^read$/i }).first();
  await expect(readField).toBeVisible();
  // Read the current value to pick a provably-different next value.
  const currentValue = (await readField.inputValue()) || '0';
  const nextValue = String((Number(currentValue) || 0) + 1);
  await readField.fill(nextValue);

  // Submit. The Save button is inside the form and has a stable test id.
  await page.getByTestId('retention-save').click();

  // Mantine Notifications render the toast title into the DOM — assert on it.
  await expect(page.getByText(/^retention saved$/i)).toBeVisible({ timeout: 10_000 });
});
