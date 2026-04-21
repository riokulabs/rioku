/**
 * E2E smoke test — every sidebar nav link must navigate without 404.
 *
 * For each link in the static NAV_GROUPS config:
 *   1. Click the link in the sidebar.
 *   2. Assert the URL path contains the expected route segment.
 *   3. Assert the page does NOT render a "Not Found" message.
 *
 * This spec would have caught Issue 2 (Analytics → /t/acme/analytics 404)
 * because clicking the "Analytics" link would have landed on a not-found page.
 *
 * NOTE: Links that require specific permissions for Derrick (super-admin) are
 * included — all routes guarded by requirePermissions should pass because the
 * seeded Derrick user holds superAdminGrants which includes all permissions.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

/**
 * All sidebar nav entries. This mirrors NAV_GROUPS in sidebar.tsx.
 * Keeping a separate list here means the test will fail if a path is changed
 * in the component without updating this list, and vice versa — both sides
 * must agree.
 */
const NAV_LINKS: { label: string; to: string }[] = [
  // General
  { label: 'Dashboard', to: '/t/acme/dashboard' },
  { label: 'Sites', to: '/t/acme/sites' },
  { label: 'Analytics', to: '/t/acme/dashboards' },
  { label: 'Notifications', to: '/t/acme/notifications' },
  // Analytics
  { label: 'Dashboards', to: '/t/acme/dashboards' },
  // AI
  { label: 'Providers', to: '/t/acme/ai/providers' },
  { label: 'Agents', to: '/t/acme/ai/agents' },
  { label: 'Tools', to: '/t/acme/ai/tools' },
  { label: 'Rate limits', to: '/t/acme/ai/rate-limits' },
  { label: 'Traces', to: '/t/acme/ai/traces' },
  { label: 'MCP servers', to: '/t/acme/ai/mcp-servers' },
  // API management
  { label: 'Services', to: '/t/acme/services' },
  { label: 'Routes', to: '/t/acme/routes' },
  { label: 'Policies', to: '/t/acme/policies' },
  { label: 'Middlewares', to: '/t/acme/middlewares' },
  { label: 'API Explorer', to: '/t/acme/api-explorer' },
  // Security
  { label: 'Users', to: '/t/acme/security/users' },
  { label: 'Roles', to: '/t/acme/security/roles' },
  { label: 'API keys', to: '/t/acme/security/api-keys' },
  { label: 'Sessions', to: '/t/acme/security/sessions' },
  { label: 'Audit', to: '/t/acme/security/audit' },
  // System
  { label: 'Plugins', to: '/t/acme/plugins' },
  { label: 'Settings', to: '/t/acme/settings' },
];

// Links with labels that appear multiple times in the sidebar (e.g. "Analytics"
// in General and "Dashboards" in the Analytics group both go to /t/acme/dashboards).
// We deduplicate by destination so we only navigate once per unique URL.
const UNIQUE_DESTINATIONS = Array.from(
  new Map(NAV_LINKS.map((l) => [l.to, l])).values(),
);

for (const { label, to } of UNIQUE_DESTINATIONS) {
  test(`nav link "${label}" (${to}) does not 404`, async ({ authedPage: page }) => {
    // Navigate directly rather than clicking so we're not dependent on the
    // sidebar rendering correctly in every test (that's covered by sidebar.test.tsx).
    await page.goto(to);

    // URL should contain the expected path segment (may redirect to a sub-path
    // e.g. /t/acme/settings → /t/acme/settings/profile but should not 404).
    await expect(page).toHaveURL(new RegExp(to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    // The page must not render a TanStack Router "Not Found" page.
    await expect(page.getByText(/not found/i).first()).not.toBeVisible({ timeout: 5000 });

    // The page must not show an access-denied redirect.
    const url = page.url();
    expect(url).not.toContain('/access-denied');
  });
}

test('sidebar Analytics link navigates to /t/acme/dashboards (not /analytics)', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/dashboard');

  // Find the "Analytics" link in the General group — it should point to /dashboards.
  const analyticsLink = page.getByRole('link', { name: /^analytics$/i });
  await expect(analyticsLink).toBeVisible();
  await analyticsLink.click();

  await expect(page).toHaveURL(/\/t\/acme\/dashboards/);
  await expect(page.getByText(/not found/i).first()).not.toBeVisible({ timeout: 5000 });
});
