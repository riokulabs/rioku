/**
 * Plan 2 accessibility spot-check — Task 2e.31.
 *
 * Navigates to each page added/expanded in Plan 2 and runs axe-core against
 * it. We only fail the test for `critical` or `serious` impact violations —
 * anything moderate/minor is tracked but not blocking. This matches the
 * convention already established in e2e/smoke/impersonation.spec.ts and the
 * helper in e2e/axe.ts.
 *
 * The API explorer route mounts Scalar, a third-party Vue component whose
 * internal markup is outside our control. We assert that the viewer loads but
 * skip the axe analysis there — running axe over Scalar's shadow DOM / nested
 * iframes consistently produces violations we cannot fix.
 *
 * `color-contrast` is no longer suppressed — the dark-mode dimmed token was
 * fixed in Task 9a.1 by overriding `--mantine-color-dimmed` to
 * `var(--mantine-color-dark-1)` (#A6A7AB) in global.css, which yields ~7.2:1
 * against the dark.7 page background (exceeds WCAG AA 4.5:1).
 */
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../fixtures/auth';

// Plan 2 routes that should be clean under axe. api-explorer is covered in a
// separate load-only assertion below.
const plan2Routes = [
  { path: '/t/acme/sites', heading: /^sites$/i },
  { path: '/t/acme/services', heading: /^services$/i },
  { path: '/t/acme/routes', heading: /^routes$/i },
  { path: '/t/acme/middlewares', heading: /middlewares/i },
  { path: '/t/acme/policies', heading: /policies/i },
] as const;

for (const route of plan2Routes) {
  test(`no critical/serious axe violations on ${route.path}`, async ({ authedPage: page }) => {
    await page.goto(route.path);

    // Wait for the page heading to confirm the route hydrated before running
    // axe — otherwise axe may evaluate the TanStack Router fallback skeleton
    // and miss real content.
    await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible({
      timeout: 10_000,
    });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );

    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}

test('api-explorer route loads (axe skipped — Scalar is third-party)', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/api-explorer');

  // Same signal used by the api-mgmt smoke spec: Scalar renders its own
  // <aside role="navigation"> inside our wrapper testid. That's the stable
  // "viewer mounted" indicator.
  await expect(page.getByTestId('api-explorer')).toBeVisible({ timeout: 15_000 });
  const scalarSidebar = page
    .getByTestId('api-explorer')
    .locator('aside[role="navigation"]')
    .first();
  await expect(scalarSidebar).toBeVisible({ timeout: 15_000 });
});
