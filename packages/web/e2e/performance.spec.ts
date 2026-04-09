import { expect } from '@playwright/test';
import { adminTest } from './fixtures';
import baseline from './perf-baseline.json' with { type: 'json' };

adminTest.describe('Performance', () => {
  adminTest('dashboard: DOMContentLoaded < 2s, full load < 4s', async ({ page }) => {
    await page.goto('/');

    const navEntry = await page.evaluate(() => {
      const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (entries.length === 0) return null;
      const e = entries[0];
      return {
        domContentLoaded: e.domContentLoadedEventEnd - e.startTime,
        fullLoad: e.loadEventEnd - e.startTime,
      };
    });

    expect(navEntry).not.toBeNull();
    if (navEntry) {
      expect(navEntry.domContentLoaded).toBeLessThan(baseline.dashboard.domContentLoaded);
      expect(navEntry.fullLoad).toBeLessThan(baseline.dashboard.fullLoad);
    }
  });

  // Table page render depends on grpc-gateway — fixme
  adminTest.fixme('table page (routes) renders in < 1s', async ({ page }) => {
    const start = Date.now();
    await page.goto('/config/routes');
    await page.waitForLoadState('networkidle');

    await page.locator('table').or(page.locator('[data-testid="data-table"]')).first().waitFor({ state: 'visible' });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(baseline.tablePage.render * (1 + baseline.regressionThreshold));
  });

  // Navigation transition to routes depends on grpc-gateway — fixme
  adminTest.fixme('navigation transition: route change < 500ms', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const start = Date.now();
    await page.locator('[data-sidebar="sidebar"]').getByText('Routes').click();
    await page.waitForURL(/\/config\/routes/);
    await page.waitForLoadState('networkidle');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(baseline.navigation.transition * (1 + baseline.regressionThreshold));
  });

  // All pages load test depends on sandbox backend — fixme
  adminTest.fixme('all pages load without timeout', async ({ page }) => {
    const pages = [
      '/config/routes',
      '/config/services',
      '/config/policies',
      '/security',
      '/traffic/live',
      '/traffic/analytics',
      '/audit',
      '/cluster',
      '/plugins',
      '/settings',
      '/settings/profile',
      '/settings/users',
      '/settings/roles',
    ];

    for (const path of pages) {
      const start = Date.now();
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(4000);
    }
  });
});
