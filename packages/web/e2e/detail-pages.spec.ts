import { authedTest as test, expect } from './fixtures';

/**
 * Detail page tests for routes, services, and policies. Verifies that clicking
 * into a detail page from the list works, tabs render, edit/YAML modes toggle,
 * and specialized tabs (traffic, activity) are present.
 */

const DETAIL_PAGE_CONFIGS = [
  {
    name: 'Routes',
    listPath: '/config/routes',
    detailPattern: /\/config\/routes\/.+/,
    tabs: ['Overview', 'Matching', 'TLS', 'Policies', 'Traffic', 'Activity'],
    hasTrafficTab: true,
    hasActivityTab: true,
  },
  {
    name: 'Services',
    listPath: '/config/services',
    detailPattern: /\/config\/services\/.+/,
    tabs: ['Overview', 'Upstreams', 'Health', 'Policies', 'Traffic', 'Activity'],
    hasTrafficTab: true,
    hasActivityTab: true,
  },
  {
    name: 'Policies',
    listPath: '/config/policies',
    detailPattern: /\/config\/policies\/.+/,
    tabs: ['Overview', 'Configuration', 'Routes', 'Activity'],
    hasTrafficTab: false,
    hasActivityTab: true,
  },
];

for (const cfg of DETAIL_PAGE_CONFIGS) {
  test.describe(`Detail Pages — ${cfg.name}`, () => {
    test(`click first item in list, detail page loads`, async ({ page }) => {
      await page.goto(cfg.listPath);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const link = page.locator('table a, [data-testid="data-table"] a').first();
      if (await link.isVisible({ timeout: 5000 }).catch(() => false)) {
        await link.click();
        await page.waitForTimeout(1000);
        await expect(page).toHaveURL(cfg.detailPattern);
        await expect(page.getByText('Something went wrong')).not.toBeVisible();
      }
    });

    test(`all tabs render without error`, async ({ page }) => {
      await page.goto(cfg.listPath);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const link = page.locator('table a, [data-testid="data-table"] a').first();
      if (!(await link.isVisible({ timeout: 5000 }).catch(() => false))) return;
      await link.click();
      await page.waitForTimeout(1000);

      for (const tabName of cfg.tabs) {
        const tab = page.getByRole('tab', { name: new RegExp(tabName, 'i') });
        if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
          await tab.click();
          await page.waitForTimeout(500);
          await expect(page.getByText('Something went wrong')).not.toBeVisible();
        }
      }
    });

    test(`edit mode activates`, async ({ page }) => {
      await page.goto(cfg.listPath);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const link = page.locator('table a, [data-testid="data-table"] a').first();
      if (!(await link.isVisible({ timeout: 5000 }).catch(() => false))) return;
      await link.click();
      await page.waitForTimeout(1000);

      const editBtn = page.getByRole('button', { name: /edit/i }).first();
      if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(500);

        // Should show save/cancel buttons
        const saveBtn = page.getByRole('button', { name: /save|update/i });
        const cancelBtn = page.getByRole('button', { name: /cancel/i });
        const hasEditUI =
          (await saveBtn.first().isVisible().catch(() => false)) ||
          (await cancelBtn.first().isVisible().catch(() => false));
        expect(hasEditUI).toBe(true);

        await expect(page.getByText('Something went wrong')).not.toBeVisible();
      }
    });

    test(`YAML toggle works`, async ({ page }) => {
      await page.goto(cfg.listPath);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const link = page.locator('table a, [data-testid="data-table"] a').first();
      if (!(await link.isVisible({ timeout: 5000 }).catch(() => false))) return;
      await link.click();
      await page.waitForTimeout(1000);

      // First enter edit mode
      const editBtn = page.getByRole('button', { name: /edit/i }).first();
      if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(500);
      }

      // Look for YAML toggle
      const yamlToggle = page.getByRole('button', { name: /yaml|code/i })
        .or(page.getByLabel(/yaml/i))
        .or(page.locator('[data-testid="yaml-toggle"]'));

      if (await yamlToggle.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await yamlToggle.first().click();
        await page.waitForTimeout(500);

        // Should show a CodeMirror editor or textarea
        const editor = page.locator('.cm-editor, .CodeMirror, textarea[class*="yaml"], [data-testid="yaml-editor"]');
        const hasEditor = await editor.first().isVisible({ timeout: 3000 }).catch(() => false);
        expect(hasEditor).toBe(true);

        await expect(page.getByText('Something went wrong')).not.toBeVisible();
      }
    });

    test(`cancel edit returns to view mode`, async ({ page }) => {
      await page.goto(cfg.listPath);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      const link = page.locator('table a, [data-testid="data-table"] a').first();
      if (!(await link.isVisible({ timeout: 5000 }).catch(() => false))) return;
      await link.click();
      await page.waitForTimeout(1000);

      const editBtn = page.getByRole('button', { name: /edit/i }).first();
      if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(500);

        const cancelBtn = page.getByRole('button', { name: /cancel/i }).first();
        if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await cancelBtn.click();
          await page.waitForTimeout(500);

          // Edit button should be visible again (view mode)
          await expect(editBtn).toBeVisible({ timeout: 3000 });
        }
      }
    });

    if (cfg.hasTrafficTab) {
      test(`traffic tab shows charts`, async ({ page }) => {
        await page.goto(cfg.listPath);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);

        const link = page.locator('table a, [data-testid="data-table"] a').first();
        if (!(await link.isVisible({ timeout: 5000 }).catch(() => false))) return;
        await link.click();
        await page.waitForTimeout(1000);

        const trafficTab = page.getByRole('tab', { name: /traffic/i });
        if (await trafficTab.isVisible({ timeout: 2000 }).catch(() => false)) {
          await trafficTab.click();
          await page.waitForTimeout(1000);

          // Should show chart containers or placeholder
          const charts = page.locator('.recharts-responsive-container, canvas, [data-testid="traffic-chart"]');
          const placeholder = page.getByText(/no.*data|no.*traffic|loading/i);
          const hasContent =
            (await charts.first().isVisible().catch(() => false)) ||
            (await placeholder.first().isVisible().catch(() => false));
          expect(hasContent).toBe(true);
          await expect(page.getByText('Something went wrong')).not.toBeVisible();
        }
      });
    }

    if (cfg.hasActivityTab) {
      test(`activity tab shows timeline entries`, async ({ page }) => {
        await page.goto(cfg.listPath);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);

        const link = page.locator('table a, [data-testid="data-table"] a').first();
        if (!(await link.isVisible({ timeout: 5000 }).catch(() => false))) return;
        await link.click();
        await page.waitForTimeout(1000);

        const activityTab = page.getByRole('tab', { name: /activity/i });
        if (await activityTab.isVisible({ timeout: 2000 }).catch(() => false)) {
          await activityTab.click();
          await page.waitForTimeout(1000);

          // Should show timeline entries or empty state
          const hasContent =
            (await page.locator('[data-testid="activity-timeline"], ul, ol').first().isVisible().catch(() => false)) ||
            (await page.getByText(/no.*activity|no.*entries|no.*changes/i).first().isVisible().catch(() => false));
          expect(hasContent).toBe(true);
          await expect(page.getByText('Something went wrong')).not.toBeVisible();
        }
      });
    }
  });
}
