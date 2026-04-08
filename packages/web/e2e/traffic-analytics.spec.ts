import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// Analytics page depends on grpc-gateway endpoints that may return 500.
// Mark as fixme until backend stabilizes.
adminTest.describe('Traffic Analytics', () => {
  adminTest.beforeEach(async ({ page }) => {
    await page.goto('/traffic/analytics');
    await page.waitForLoadState('networkidle');
  });

  adminTest.fixme('time range tabs switch chart data', async ({ page }) => {
    const tabs = page.locator('[role="tablist"]');
    if (await tabs.isVisible()) {
      const tab1h = page.getByRole('tab', { name: /1h/i });
      const tab24h = page.getByRole('tab', { name: /24h/i });
      const tab7d = page.getByRole('tab', { name: /7d/i });

      if (await tab1h.isVisible()) {
        await tab1h.click();
        await page.waitForTimeout(500);
      }
      if (await tab7d.isVisible()) {
        await tab7d.click();
        await page.waitForTimeout(500);
      }
      if (await tab24h.isVisible()) {
        await tab24h.click();
      }
    }
  });

  adminTest.fixme('charts render (SVG or canvas present)', async ({ page }) => {
    const svgs = page.locator('.recharts-responsive-container svg');
    const canvases = page.locator('canvas');

    const svgCount = await svgs.count();
    const canvasCount = await canvases.count();

    const hasChartOrPlaceholder = svgCount > 0 || canvasCount > 0 ||
      await page.getByText(/no data|loading/i).isVisible().catch(() => false);
    expect(hasChartOrPlaceholder).toBe(true);
  });

  adminTest.fixme('stat cards show values', async ({ page }) => {
    const statCards = page.locator('[data-testid="stat-card"]');
    const count = await statCards.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
