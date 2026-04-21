/**
 * Plan 4 accessibility spot-check — Task 4e.25.
 *
 * Navigates to each dashboard-related route introduced in Plan 4 and runs
 * axe-core against it. Only `critical` / `serious` impact violations fail
 * the test — same convention as plan2-a11y.spec.ts / plan3-a11y.spec.ts.
 *
 * `color-contrast` is no longer suppressed — the dark-mode dimmed token was
 * fixed in Task 9a.1 by overriding `--mantine-color-dimmed` to
 * `var(--mantine-color-dark-1)` (#A6A7AB) in global.css, which yields ~7.2:1
 * against the dark.7 page background (exceeds WCAG AA 4.5:1).
 */
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, getStoreState } from '../fixtures/auth';

async function firstAcmeDashboardId(
  page: Parameters<typeof getStoreState>[0],
): Promise<string> {
  // Drive a navigation so the addInitScript-driven reseed runs to completion
  // before we read store state.
  await page.goto('/t/acme/dashboards');
  await page.waitForFunction(() => {
    const store = (window as unknown as {
      __RIOKU_STORE?: {
        getState: () => { tenants: Record<string, { slug: string }> };
      };
    }).__RIOKU_STORE;
    if (!store) return false;
    const { tenants } = store.getState();
    return Object.values(tenants).some((t) => t.slug === 'acme');
  }, null, { timeout: 10_000 });
  const state = (await getStoreState(page)) as {
    tenants: Record<string, { id: string; slug: string }>;
    dashboards: Record<string, { id: string; tenant_id: string }>;
  };
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('acme tenant not seeded');
  const dash = Object.values(state.dashboards).find(
    (d) => d.tenant_id === acme.id,
  );
  if (!dash) throw new Error('no acme dashboard seeded');
  return dash.id;
}

test('no critical/serious axe violations on /t/acme/dashboards', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/dashboards');

  await expect(
    page.getByRole('heading', { name: /^dashboards$/i }),
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

test('no critical/serious axe violations on dashboard viewer', async ({
  authedPage: page,
}) => {
  const dashId = await firstAcmeDashboardId(page);
  await page.goto(`/t/acme/dashboards/${dashId}`);

  // The viewer renders a role="list" aria-label="... dashboard widgets" once hydrated.
  await expect(
    page.getByRole('list', { name: /dashboard widgets/i }),
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

test('no critical/serious axe violations on dashboard builder', async ({
  authedPage: page,
}) => {
  const dashId = await firstAcmeDashboardId(page);
  await page.goto(`/t/acme/dashboards/${dashId}/edit`);

  await expect(page.getByTestId('dashboard-builder-shell')).toBeVisible({
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
