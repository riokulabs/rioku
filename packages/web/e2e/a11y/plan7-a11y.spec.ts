/**
 * Plan 7 accessibility spot-check — Task 7d.15.
 *
 * Runs axe-core against each notification surface introduced in Plan 7:
 *
 *   - /t/acme/notifications                   (inbox page)
 *   - /t/acme/settings/notifications          (settings index cards)
 *   - /t/acme/settings/notification-channels  (channels list)
 *   - /t/acme/settings/notification-routing   (routing rules list)
 *   - /t/acme/settings/notification-delivery  (delivery log list)
 *
 * Only `critical` / `serious` impact violations fail the test — same
 * convention as plan2/3/4/5/6 a11y specs.
 *
 * `color-contrast` is suppressed: Mantine's dark-mode dimmed token surfaces
 * on shared DataTable internals pre-date Plan 7 and fixing that is a
 * theme-level decision tracked separately. This spec still catches missing
 * labels, duplicate ids, ARIA-role misuse, and other structural a11y issues
 * in Plan 7 feature code.
 */
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../fixtures/auth';

test('no critical/serious axe violations on /t/acme/notifications', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/notifications');

  await expect(
    page.getByRole('heading', { name: /^notifications$/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Wait for the list to hydrate so axe walks the seeded row tree.
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

test('no critical/serious axe violations on /t/acme/settings/notifications', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/notifications');

  await expect(
    page.getByTestId('notifications-settings-index'),
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

test('no critical/serious axe violations on /t/acme/settings/notification-channels', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/notification-channels');

  await expect(
    page.getByTestId('notification-channels-page'),
  ).toBeVisible({ timeout: 10_000 });

  // Wait for the channels table to hydrate.
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

test('no critical/serious axe violations on /t/acme/settings/notification-routing', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/notification-routing');

  await expect(
    page.getByRole('heading', { name: /routing rules/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Wait for the routing rules table to hydrate.
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

test('no critical/serious axe violations on /t/acme/settings/notification-delivery', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/notification-delivery');

  await expect(
    page.getByRole('heading', { name: /delivery log/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Wait for the delivery log table to hydrate.
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
