/**
 * Full-app accessibility sweep — Task 9a.2.
 *
 * Navigates to EVERY route in the app (derived from the route filesystem and
 * both sidebars) and runs axe-core against it. Only `critical` / `serious`
 * impact violations fail the test — same convention as plan2–8 a11y specs.
 *
 * `color-contrast` is enabled — the dark-mode dimmed token was fixed in
 * Task 9a.1 by overriding `--mantine-color-dimmed` to
 * `var(--mantine-color-dark-1)` (#A6A7AB) in global.css, which yields ~7.2:1
 * against the dark.7 page background (exceeds WCAG AA 4.5:1).
 *
 * Routes are grouped into three categories:
 *   1. Tenant routes — standard heading-wait + networkidle strategy
 *   2. Tenant settings (section-param) — testid-based wait per section
 *   3. Admin routes — heading-wait + networkidle strategy
 *
 * The api-explorer route is treated as a load-only assertion: Scalar renders
 * in its own shadow DOM / Vue runtime and consistently produces violations
 * outside our control. axe is scoped to `[data-testid="api-explorer-shell"]`
 * (the host wrapper) to skip Scalar's internals while still checking our
 * wrapper markup.
 */
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, getStoreState } from '../fixtures/auth';

// ---------------------------------------------------------------------------
// Helper: get a seeded acme dashboard id (reused from plan4-a11y.spec.ts)
// ---------------------------------------------------------------------------
async function firstAcmeDashboardId(page: Parameters<typeof getStoreState>[0]): Promise<string> {
  await page.goto('/t/acme/dashboards');
  await page.waitForFunction(
    () => {
      const store = (
        window as unknown as {
          __RIOKU_STORE?: {
            getState: () => { tenants: Record<string, { slug: string }> };
          };
        }
      ).__RIOKU_STORE;
      if (!store) return false;
      const { tenants } = store.getState();
      return Object.values(tenants).some((t) => t.slug === 'acme');
    },
    null,
    { timeout: 10_000 },
  );
  const state = (await getStoreState(page)) as {
    tenants: Record<string, { id: string; slug: string }>;
    dashboards: Record<string, { id: string; tenant_id: string }>;
  };
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('acme tenant not seeded');
  const dash = Object.values(state.dashboards).find((d) => d.tenant_id === acme.id);
  if (!dash) throw new Error('no acme dashboard seeded');
  return dash.id;
}

// ---------------------------------------------------------------------------
// Standard axe assertion helper
// ---------------------------------------------------------------------------
async function assertNoBlockingViolations(
  page: Parameters<typeof getStoreState>[0],
): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

// ===========================================================================
// 1. Tenant routes — heading-wait strategy
// ===========================================================================
const tenantHeadingRoutes = [
  // /t/acme/dashboard resolves to DashboardViewer (acme has a default dashboard
  // seeded at di=0), so no heading with text "dashboard" is rendered. Use the
  // DashboardViewer signal (role="list" aria-label="... dashboard widgets")
  // directly in the dedicated test below instead of the heading-wait loop.
  // { path: '/t/acme/dashboard', heading: /dashboard/i }, ← handled separately
  { path: '/t/acme/services', heading: /^services$/i },
  { path: '/t/acme/routes', heading: /^routes$/i },
  { path: '/t/acme/sites', heading: /^sites$/i },
  { path: '/t/acme/middlewares', heading: /middlewares/i },
  { path: '/t/acme/policies', heading: /policies/i },
  { path: '/t/acme/ai/providers', heading: /^ai providers$/i },
  { path: '/t/acme/ai/agents', heading: /^ai agents$/i },
  { path: '/t/acme/ai/tools', heading: /^ai tools$/i },
  { path: '/t/acme/ai/tool-routing', heading: /tool routing/i },
  { path: '/t/acme/ai/mcp-servers', heading: /mcp servers/i },
  { path: '/t/acme/ai/rate-limits', heading: /rate limits/i },
  { path: '/t/acme/ai/traces', heading: /^ai traces$/i },
  { path: '/t/acme/dashboards', heading: /^dashboards$/i },
  { path: '/t/acme/notifications', heading: /^notifications$/i },
  { path: '/t/acme/plugins?tab=marketplace', heading: /^plugins$/i },
  { path: '/t/acme/plugins?tab=installed', heading: /^plugins$/i },
  { path: '/t/acme/plugins/signers', heading: /^plugin signers$/i },
  { path: '/t/acme/security/users', heading: /^users$/i },
  { path: '/t/acme/security/roles', heading: /^roles$/i },
  { path: '/t/acme/security/rbac-policies', heading: /rbac/i },
  { path: '/t/acme/security/access-policies', heading: /access policies/i },
  { path: '/t/acme/security/api-keys', heading: /api keys/i },
  { path: '/t/acme/security/sessions', heading: /^sessions$/i },
  { path: '/t/acme/security/audit', heading: /^audit log$/i },
  { path: '/t/acme/settings/audit-retention', heading: /^audit retention$/i },
  { path: '/t/acme/settings/notifications', heading: /notification/i },
  { path: '/t/acme/settings/notification-channels', heading: /notification/i },
  { path: '/t/acme/settings/notification-routing', heading: /routing rules/i },
  { path: '/t/acme/settings/notification-delivery', heading: /delivery log/i },
] as const;

for (const route of tenantHeadingRoutes) {
  test(`no critical/serious axe violations on ${route.path}`, async ({ authedPage: page }) => {
    await page.goto(route.path);

    await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible({
      timeout: 10_000,
    });

    await assertNoBlockingViolations(page);
  });
}

// ===========================================================================
// 2. Tenant home /t/acme/dashboard (renders DashboardViewer for acme)
//
// Acme's first seeded dashboard is the default (di=0 → default: true).
// DashboardPage renders <DashboardViewer> inline (no "dashboard" heading),
// so we use the DashboardViewer's stable "widgets list" signal.
// ===========================================================================
test('no critical/serious axe violations on /t/acme/dashboard (home)', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/dashboard');

  // DashboardViewer mounts a role="list" aria-label="<name> dashboard widgets"
  // once hydrated — the same signal used by plan4-a11y.spec.ts.
  await expect(page.getByRole('list', { name: /dashboard widgets/i })).toBeVisible({
    timeout: 10_000,
  });

  await assertNoBlockingViolations(page);
});

// ===========================================================================
// 3. Dashboard viewer and builder (need dynamic id)
// ===========================================================================
test('no critical/serious axe violations on dashboard viewer', async ({ authedPage: page }) => {
  const dashId = await firstAcmeDashboardId(page);
  await page.goto(`/t/acme/dashboards/${dashId}`);

  await expect(page.getByRole('list', { name: /dashboard widgets/i })).toBeVisible({
    timeout: 10_000,
  });

  await assertNoBlockingViolations(page);
});

test('no critical/serious axe violations on dashboard builder', async ({ authedPage: page }) => {
  const dashId = await firstAcmeDashboardId(page);
  await page.goto(`/t/acme/dashboards/${dashId}/edit`);

  await expect(page.getByTestId('dashboard-builder-shell')).toBeVisible({
    timeout: 10_000,
  });

  await assertNoBlockingViolations(page);
});

// ===========================================================================
// 3. Settings section-param routes (testid-based wait)
// ===========================================================================
const settingsSections = [
  { section: 'profile', testid: 'profile-section' },
  { section: 'tenant', testid: 'tenant-section' },
  { section: 'authentication', testid: 'auth-policy-form' },
  { section: 'network', testid: 'fieldset-listen-addresses' },
  { section: 'pki', testid: 'pki-section' },
  { section: 'tls', testid: 'tls-section' },
  { section: 'observability', testid: 'observability-section' },
  { section: 'integrations', testid: 'integrations-section' },
  { section: 'plugins', testid: 'plugin-settings-section' },
  { section: 'danger-zone', testid: 'danger-zone-section' },
] as const;

for (const { section, testid } of settingsSections) {
  test(`no critical/serious axe violations on settings?section=${section}`, async ({
    authedPage: page,
  }) => {
    await page.goto(`/t/acme/settings/?section=${section}`);

    await expect(page.getByTestId(testid)).toBeVisible({ timeout: 10_000 });

    await assertNoBlockingViolations(page);
  });
}

// ===========================================================================
// 4. API explorer — axe excludes Scalar's rendered content (third-party)
//
// Scalar (Vue 3 component) renders its full reference UI inside our
// [data-testid="api-explorer"] host element. We cannot fix Scalar's
// internal color-contrast issues (.client-libraries-text-more #797979 on
// #0f0f0f = 4.4:1, .property-default-label #797979 on #0f0f0f = 4.4:1 —
// both just below the 4.5:1 WCAG AA threshold) because they are inside
// Scalar's Vue component with data-v-* scoped styles.
//
// Strategy: exclude `main.references-rendered` (Scalar's rendered doc area)
// from the axe scope so we still test our wrapper chrome, the loading state,
// the permission boundary, and the app-shell around the explorer — while
// skipping Scalar's internals.
// ===========================================================================
test('no critical/serious axe violations on api-explorer (excluding Scalar internals)', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/api-explorer');

  // Wait for Scalar's own sidebar to mount — this is the "viewer loaded" signal
  // established by plan2-a11y.spec.ts and the smoke spec.
  await expect(page.getByTestId('api-explorer')).toBeVisible({ timeout: 15_000 });
  const scalarSidebar = page
    .getByTestId('api-explorer')
    .locator('aside[role="navigation"]')
    .first();
  await expect(scalarSidebar).toBeVisible({ timeout: 15_000 });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Exclude Scalar's rendered documentation area from the axe run.
  // `main.references-rendered` is Scalar's Vue-rendered content pane —
  // it contains data-v-* scoped elements with contrast ratios we cannot fix.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('main.references-rendered')
    .exclude('.scalar-app')
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});

// ===========================================================================
// 5. Admin routes — heading-wait strategy
// ===========================================================================
const adminHeadingRoutes = [
  { path: '/admin/tenants', heading: /tenants/i },
  { path: '/admin/users', heading: /users/i },
  { path: '/admin/impersonate', heading: /impersonation/i },
  { path: '/admin/cluster', heading: /cluster/i },
  { path: '/admin/audit', heading: /audit/i },
  { path: '/admin/plugin-signers', heading: /^plugin signers$/i },
] as const;

for (const route of adminHeadingRoutes) {
  test(`no critical/serious axe violations on ${route.path}`, async ({ authedPage: page }) => {
    await page.goto(route.path);

    await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible({
      timeout: 10_000,
    });

    await assertNoBlockingViolations(page);
  });
}
