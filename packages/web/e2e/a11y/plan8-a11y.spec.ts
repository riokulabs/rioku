/**
 * Plan 8 accessibility spot-check — Task 8d.17.
 *
 * Runs axe-core against each settings section introduced/populated in Plan 8:
 *
 *   - /t/acme/settings/?section=profile
 *   - /t/acme/settings/?section=tenant
 *   - /t/acme/settings/?section=authentication
 *   - /t/acme/settings/?section=network
 *   - /t/acme/settings/?section=pki
 *   - /t/acme/settings/?section=tls
 *   - /t/acme/settings/?section=observability
 *   - /t/acme/settings/?section=integrations
 *   - /t/acme/settings/?section=plugins
 *   - /t/acme/settings/?section=danger-zone
 *
 * Only `critical` / `serious` impact violations fail the test — same
 * convention as plan2–7 a11y specs.
 *
 * `color-contrast` is no longer suppressed — the dark-mode dimmed token was
 * fixed in Task 9a.1 by overriding `--mantine-color-dimmed` to
 * `var(--mantine-color-dark-1)` (#A6A7AB) in global.css, which yields ~7.2:1
 * against the dark.7 page background (exceeds WCAG AA 4.5:1).
 */
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../fixtures/auth';

test('no critical/serious axe violations on settings?section=profile', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=profile');

  await expect(
    page.getByTestId('profile-section'),
  ).toBeVisible({ timeout: 10_000 });

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

test('no critical/serious axe violations on settings?section=tenant', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=tenant');

  await expect(
    page.getByTestId('tenant-section'),
  ).toBeVisible({ timeout: 10_000 });

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

test('no critical/serious axe violations on settings?section=authentication', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=authentication');

  await expect(
    page.getByTestId('auth-policy-form'),
  ).toBeVisible({ timeout: 10_000 });

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

test('no critical/serious axe violations on settings?section=network', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=network');

  // Wait for the listen addresses fieldset — first stable element of the
  // network form. Monaco editor loads lazily; networkidle + timeout below
  // let the lazy chunk settle before axe walks the tree.
  await expect(
    page.getByTestId('fieldset-listen-addresses'),
  ).toBeVisible({ timeout: 10_000 });

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

test('no critical/serious axe violations on settings?section=pki', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=pki');

  await expect(
    page.getByTestId('pki-section'),
  ).toBeVisible({ timeout: 10_000 });

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

test('no critical/serious axe violations on settings?section=tls', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=tls');

  await expect(
    page.getByTestId('tls-section'),
  ).toBeVisible({ timeout: 10_000 });

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

test('no critical/serious axe violations on settings?section=observability', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=observability');

  await expect(
    page.getByTestId('observability-section'),
  ).toBeVisible({ timeout: 10_000 });

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

test('no critical/serious axe violations on settings?section=integrations', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=integrations');

  await expect(
    page.getByTestId('integrations-section'),
  ).toBeVisible({ timeout: 10_000 });

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

test('no critical/serious axe violations on settings?section=plugins', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=plugins');

  await expect(
    page.getByTestId('plugin-settings-section'),
  ).toBeVisible({ timeout: 10_000 });

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

test('no critical/serious axe violations on settings?section=danger-zone', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/settings/?section=danger-zone');

  await expect(
    page.getByTestId('danger-zone-section'),
  ).toBeVisible({ timeout: 10_000 });

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
