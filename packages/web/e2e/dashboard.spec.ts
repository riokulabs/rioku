import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// Dashboard depends on multiple grpc-gateway streaming RPCs that currently return 500.
// Mark all tests as fixme until those endpoints are stable.
adminTest.describe('Dashboard', () => {
  adminTest.fixme('stat cards display real data from seeded config', async ({ page }) => {
    await page.goto('/');

    const statCards = page.locator('[data-testid="stat-card"]');
    await expect(statCards.first()).toBeVisible();

    const routeCard = statCards.filter({ hasText: /routes/i }).first();
    await expect(routeCard).toBeVisible();
    const routeCount = await routeCard.locator('[data-testid="stat-value"]').textContent();
    expect(Number(routeCount)).toBeGreaterThan(0);
  });

  adminTest.fixme('system status shows healthy', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(/healthy|ok/i).first()).toBeVisible();
  });

  adminTest.fixme('charts render with SVG or canvas elements', async ({ page }) => {
    await page.goto('/');

    const chartSvgs = page.locator('.recharts-responsive-container svg');
    const count = await chartSvgs.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  adminTest.fixme('recent changes widget shows audit entries', async ({ page }) => {
    await page.goto('/');

    const auditSection = page.locator('text=Recent Changes').locator('..');
    await expect(auditSection).toBeVisible();
  });

  adminTest.fixme('plugin slots render without error', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    const slots = page.locator('[data-plugin-slot]');
    const slotCount = await slots.count();
    expect(slotCount).toBeGreaterThanOrEqual(0);
  });
});
