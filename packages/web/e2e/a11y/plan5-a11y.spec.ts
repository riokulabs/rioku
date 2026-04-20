/**
 * Plan 5 accessibility spot-check — Task 5d.15.
 *
 * Navigates to each audit-related route introduced in Plan 5 and runs
 * axe-core against it. Only `critical` / `serious` impact violations fail
 * the test — same convention as plan2/3/4 a11y specs.
 *
 * The `color-contrast` rule is suppressed for the same reason documented
 * in earlier plan a11y specs: Mantine's dark-mode dimmed token surfaces on
 * shared DataTable internals pre-date Plan 5. Fixing that is a theme-level
 * decision tracked separately. This spec still catches missing labels,
 * duplicate ids, ARIA-role misuse, and other structural a11y issues in
 * Plan 5 feature code (filter bar, detail drawer, retention form).
 */
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../fixtures/auth';

test('no critical/serious axe violations on /t/acme/security/audit', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/audit');

  await expect(
    page.getByRole('heading', { name: /^audit log$/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Ensure the list has hydrated — guarantees the DataTable rows and the
  // filter bar controls are in the DOM before axe walks it.
  await expect(
    page.locator('tbody tr[role="row"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});

test('no critical/serious axe violations on /t/acme/settings/audit-retention', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/audit-retention');

  await expect(
    page.getByRole('heading', { name: /^audit retention$/i }),
  ).toBeVisible({ timeout: 10_000 });

  await expect(page.getByTestId('audit-retention-form')).toBeVisible({
    timeout: 10_000,
  });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});
