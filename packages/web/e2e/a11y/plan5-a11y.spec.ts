/**
 * Plan 5 accessibility spot-check — Task 5d.15.
 *
 * Navigates to each audit-related route introduced in Plan 5 and runs
 * axe-core against it. Only `critical` / `serious` impact violations fail
 * the test — same convention as plan2/3/4 a11y specs.
 *
 * `color-contrast` is no longer suppressed — the dark-mode dimmed token was
 * fixed in Task 9a.1 by overriding `--mantine-color-dimmed` to
 * `var(--mantine-color-dark-1)` (#A6A7AB) in global.css, which yields ~7.2:1
 * against the dark.7 page background (exceeds WCAG AA 4.5:1).
 */
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../fixtures/auth';

test('no critical/serious axe violations on /t/acme/security/audit', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/security/audit');

  await expect(page.getByRole('heading', { name: /^audit log$/i })).toBeVisible({
    timeout: 10_000,
  });

  // Ensure the list has hydrated — guarantees the DataTable rows and the
  // filter bar controls are in the DOM before axe walks it.
  await expect(page.locator('tbody tr[role="row"]').first()).toBeVisible({ timeout: 10_000 });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
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

  await expect(page.getByRole('heading', { name: /^audit retention$/i })).toBeVisible({
    timeout: 10_000,
  });

  await expect(page.getByTestId('audit-retention-form')).toBeVisible({
    timeout: 10_000,
  });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});
