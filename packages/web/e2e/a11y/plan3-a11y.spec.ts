/**
 * Plan 3 accessibility spot-check — Task 3e.24.
 *
 * Navigates to each AI route added in Plan 3 and runs axe-core against it.
 * Only `critical` / `serious` impact violations fail the test — matching the
 * convention in e2e/a11y/plan2-a11y.spec.ts.
 *
 * `color-contrast` is no longer suppressed — the dark-mode dimmed token was
 * fixed in Task 9a.1 by overriding `--mantine-color-dimmed` to
 * `var(--mantine-color-dark-1)` (#A6A7AB) in global.css, which yields ~7.2:1
 * against the dark.7 page background (exceeds WCAG AA 4.5:1).
 */
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../fixtures/auth';

const plan3Routes = [
  { path: '/t/acme/ai/providers', heading: /^ai providers$/i },
  { path: '/t/acme/ai/agents', heading: /^ai agents$/i },
  { path: '/t/acme/ai/tools', heading: /^ai tools$/i },
  { path: '/t/acme/ai/tool-routing', heading: /tool routing/i },
  { path: '/t/acme/ai/rate-limits', heading: /rate limits/i },
  { path: '/t/acme/ai/traces', heading: /^ai traces$/i },
  { path: '/t/acme/ai/mcp-servers', heading: /mcp servers/i },
] as const;

for (const route of plan3Routes) {
  test(`no critical/serious axe violations on ${route.path}`, async ({
    authedPage: page,
  }) => {
    await page.goto(route.path);

    // Wait for the page heading to confirm the route hydrated before running
    // axe — otherwise axe may evaluate the TanStack Router fallback skeleton
    // and miss real content.
    await expect(
      page.getByRole('heading', { name: route.heading }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Let the DOM settle before running axe. Some feature pages (traces,
    // rate-limits) trigger an initial URL rewrite via debounced search effects
    // or `validateSearch` normalization; axe's page.evaluate fails with
    // "Execution context was destroyed" if that rewrite races with analyze().
    // Waiting for networkidle + a short paint tick ensures the route has
    // finished its initial render before axe crawls the tree.
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
}
