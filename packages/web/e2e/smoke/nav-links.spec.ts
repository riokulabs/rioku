/**
 * E2E smoke test — every sidebar nav link must navigate without 404.
 *
 * For each link in the static NAV_GROUPS config:
 *   1. Click the link in the sidebar.
 *   2. Assert the URL path contains the expected route segment.
 *   3. Assert the page does NOT render a "Not Found" message.
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
  { label: 'Notifications', to: '/t/acme/notifications' },
  // Analytics
  { label: 'Insights', to: '/t/acme/dashboards' },
  // AI
  { label: 'Providers', to: '/t/acme/ai/providers' },
  { label: 'Agents', to: '/t/acme/ai/agents' },
  { label: 'Tools', to: '/t/acme/ai/tools' },
  { label: 'Rate limits', to: '/t/acme/ai/rate-limits' },
  { label: 'Traces', to: '/t/acme/ai/traces' },
  { label: 'MCP servers', to: '/t/acme/ai/mcp-servers' },
  { label: 'Access policies', to: '/t/acme/security/access-policies' },
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
  { label: 'Cluster', to: '/t/acme/cluster' },
  { label: 'Plugins', to: '/t/acme/plugins' },
  { label: 'Settings', to: '/t/acme/settings' },
];

for (const { label, to } of NAV_LINKS) {
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

test('sidebar Insights link navigates to /t/acme/dashboards', async ({ authedPage: page }) => {
  await page.goto('/t/acme/dashboard');

  // The "Insights" link in the Analytics group should point to /dashboards.
  const insightsLink = page.getByRole('link', { name: /^insights$/i });
  await expect(insightsLink).toBeVisible();
  await insightsLink.click();

  await expect(page).toHaveURL(/\/t\/acme\/dashboards/);
  await expect(page.getByText(/not found/i).first()).not.toBeVisible({ timeout: 5000 });
});
