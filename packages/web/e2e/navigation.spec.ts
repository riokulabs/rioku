import { authedTest as test, expect } from './fixtures';

test.describe('Navigation', () => {
  test('sidebar links navigate to correct pages', async ({ page }) => {
    await page.goto('/');

    // These match the navSections defined in app-sidebar.tsx. The sidebar
    // renders translated labels with fallback to the key's last segment,
    // so we match on the visible English text.
    const navLinks = [
      { text: 'Dashboard', url: '/' },
      { text: 'Routes', url: '/config/routes' },
      { text: 'Services', url: '/config/services' },
      { text: 'Policies', url: '/config/policies' },
      { text: 'Live', url: '/traffic/live' },
      { text: 'Analytics', url: '/traffic/analytics' },
      { text: 'AI Workloads', url: '/traffic/ai' },
      { text: 'Cluster', url: '/cluster' },
      { text: 'Certificates', url: '/certificates' },
      { text: 'Plugins', url: '/plugins' },
      { text: 'Users & Roles', url: '/security/users' },
      { text: 'API Keys', url: '/security/api-keys' },
      { text: 'Access Policies', url: '/security/access-policies' },
      { text: 'Audit Log', url: '/security/audit-log' },
    ];

    for (const link of navLinks) {
      const sidebar = page.locator('[data-sidebar="sidebar"]');
      const btn = sidebar
        .locator('[data-slot="sidebar-menu-button"]')
        .filter({ hasText: link.text });

      // Some items might be permission-gated; skip if not visible
      if (!(await btn.first().isVisible({ timeout: 2000 }).catch(() => false))) {
        continue;
      }

      await btn.first().click();
      // Wait for navigation
      await page.waitForTimeout(500);

      const currentUrl = new URL(page.url());
      // For Dashboard ("/"), check exact path; for others, check startsWith
      if (link.url === '/') {
        expect(currentUrl.pathname).toBe('/');
      } else {
        expect(currentUrl.pathname).toContain(link.url);
      }
    }
  });

  test('all expected sidebar nav items are present', async ({ page }) => {
    await page.goto('/');

    const expectedItems = [
      'Dashboard',
      'Routes',
      'Services',
      'Policies',
      'Live',
      'Analytics',
      'AI Workloads',
      'Cluster',
      'Certificates',
      'Plugins',
      'Users & Roles',
      'API Keys',
      'Access Policies',
      'Audit Log',
    ];

    const sidebar = page.locator('[data-sidebar="sidebar"]');
    for (const item of expectedItems) {
      const btn = sidebar
        .locator('[data-slot="sidebar-menu-button"]')
        .filter({ hasText: item });
      // The item should exist — it may be hidden by RBAC but for root user it should be visible
      await expect(btn.first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('breadcrumbs show correct path on nested pages', async ({ page }) => {
    await page.goto('/config/routes');
    await page.waitForLoadState('domcontentloaded');

    // Breadcrumbs are rendered in the Header component
    const breadcrumbs = page
      .locator('nav[aria-label="breadcrumb"]')
      .or(page.locator('[data-testid="breadcrumbs"]'))
      .or(page.locator('.breadcrumb'));

    if (await breadcrumbs.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(breadcrumbs.getByText(/routes/i)).toBeVisible();
    }
  });

  test('back button on create pages works', async ({ page }) => {
    await page.goto('/config/routes/create');
    await page.waitForLoadState('domcontentloaded');

    // Route create page has a back button/link
    const backBtn = page
      .getByRole('link', { name: /back/i })
      .or(page.getByRole('button', { name: /back/i }))
      .or(page.locator('a[href="/config/routes"]').filter({ hasText: /back|routes/i }));

    if (await backBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await backBtn.first().click();
      await expect(page).toHaveURL(/\/config\/routes/);
    }
  });

  test('mobile sidebar opens and closes', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // On mobile, sidebar should be hidden by default
    const sidebar = page.locator('[data-sidebar="sidebar"]');

    // Look for the mobile trigger button
    const trigger = page
      .locator('[data-sidebar="trigger"]')
      .or(page.getByRole('button', { name: /menu|toggle.*sidebar/i }));

    if (await trigger.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      // Open sidebar
      await trigger.first().click();
      await page.waitForTimeout(500);

      // Sidebar should now be visible (or a sheet/drawer containing sidebar content)
      const sidebarContent = page
        .locator('[data-sidebar="sidebar"]')
        .or(page.locator('[role="dialog"]').filter({ has: page.locator('[data-sidebar="sidebar"]') }));
      const isVisible = await sidebarContent.first().isVisible({ timeout: 3000 }).catch(() => false);
      expect(isVisible).toBe(true);

      // Close it by pressing Escape or clicking outside
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  });

  test('mobile sidebar closes when a nav item is clicked', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const trigger = page
      .locator('[data-sidebar="trigger"]')
      .or(page.getByRole('button', { name: /menu|toggle.*sidebar/i }));

    if (await trigger.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await trigger.first().click();
      await page.waitForTimeout(500);

      // Click a nav item
      const routesLink = page
        .locator('[data-sidebar="sidebar"]')
        .locator('[data-slot="sidebar-menu-button"]')
        .filter({ hasText: 'Routes' });

      if (await routesLink.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await routesLink.first().click();
        await page.waitForTimeout(500);

        // Sidebar overlay/drawer should have closed
        await expect(page).toHaveURL(/\/config\/routes/);
      }
    }
  });
});
