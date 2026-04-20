/**
 * Plan 6 accessibility spot-check — Task 6c.9.
 *
 * Navigates to each plugin-related route introduced or extended in Plan 6 and
 * runs axe-core. Only `critical` / `serious` impact violations fail the test
 * — same convention as plan2/3/4/5 a11y specs.
 *
 * `color-contrast` is suppressed: Mantine's dark-mode dimmed token surfaces
 * on shared DataTable internals pre-date Plan 6 and fixing that is a
 * theme-level decision tracked separately. This spec still catches missing
 * labels, duplicate ids, ARIA-role misuse, and other structural a11y issues
 * in Plan 6 feature code (signer list/form, marketplace category sidebar,
 * install-progress modal stage strip).
 */
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../fixtures/auth';

test('no critical/serious axe violations on /t/acme/plugins (marketplace tab)', async ({
  authedPage: page,
}) => {
  // Plan 6 adds the category sidebar + verified toggle + sort select to this
  // view. Navigate directly to the marketplace tab so axe inspects it.
  await page.goto('/t/acme/plugins?tab=marketplace');

  await expect(
    page.getByRole('heading', { name: /^plugins$/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Ensure at least one marketplace card is in the DOM — axe walks the
  // rendered tree, so we wait for hydration.
  await expect(
    page.getByTestId('marketplace-listing-com.rioku.jwt-auth'),
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

test('no critical/serious axe violations on /t/acme/plugins?tab=installed', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/plugins?tab=installed');

  await expect(
    page.getByRole('heading', { name: /^plugins$/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Installed tab: wait for the DataTable body to render at least one row OR
  // the empty state — tenant acme seeds plugins so rows should be present.
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

test('no critical/serious axe violations on /t/acme/plugins/signers', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/plugins/signers');

  await expect(
    page.getByRole('heading', { name: /^plugin signers$/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Wait for the signer list to render — at least one seeded row for acme.
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

test('no critical/serious axe violations on /admin/plugin-signers', async ({
  authedPage: page,
}) => {
  await page.goto('/admin/plugin-signers');

  await expect(
    page.getByRole('heading', { name: /^plugin signers$/i }),
  ).toBeVisible({ timeout: 10_000 });

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
