/**
 * Plan 3 accessibility spot-check — Task 3e.24.
 *
 * Navigates to each AI route added in Plan 3 and runs axe-core against it.
 * Only `critical` / `serious` impact violations fail the test — matching the
 * convention in e2e/a11y/plan2-a11y.spec.ts.
 *
 * The `color-contrast` rule is suppressed for the same reason documented in
 * plan2-a11y.spec.ts: Mantine's dark-mode `--mantine-color-dimmed` token
 * (#828282 on the table background and #495057 on pagination disabled states)
 * is surfaced by shared DataTable internals shipped before Plan 3. Fixing
 * this is a framework-theme decision that belongs in a separate contrast
 * audit of the Mantine theme, not in Plan 3 feature code. The spec is still
 * meaningful — it catches missing labels, duplicate IDs, ARIA-role misuse,
 * and other structural issues in the pages Plan 3 introduces.
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
      .disableRules(['color-contrast'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );

    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}
