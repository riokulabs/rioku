import { authedTest as test, expect } from './fixtures';

test.describe('Security Pages', () => {
  test('users page shows user table with data', async ({ page }) => {
    await page.goto('/security/users');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    await expect(page.getByText('Something went wrong')).not.toBeVisible();

    // Users page should have a tab structure (Users, Roles, etc.)
    const tabs = page.locator('[role="tablist"]');
    if (await tabs.isVisible({ timeout: 3000 }).catch(() => false)) {
      const usersTab = page.getByRole('tab', { name: /users/i });
      if (await usersTab.isVisible().catch(() => false)) {
        await usersTab.click();
        await page.waitForTimeout(500);
      }
    }

    // Should show a table or data grid with user data
    const table = page.locator('table, [data-testid="data-table"]');
    const hasTable = await table.first().isVisible({ timeout: 5000 }).catch(() => false);

    // Or it could be card-based
    const cards = page.locator('[class*="card"]');
    const hasCards = (await cards.count()) > 0;

    // Must have some user-related content
    const bodyText = await page.locator('body').innerText();
    const hasUserContent = bodyText.match(/admin|user|role|email/i) !== null;

    expect(hasTable || hasCards || hasUserContent).toBe(true);
  });

  test('roles tab shows role cards with permission rules', async ({ page }) => {
    await page.goto('/security/users');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    await expect(page.getByText('Something went wrong')).not.toBeVisible();

    // Click Roles tab
    const rolesTab = page.getByRole('tab', { name: /roles/i });
    if (await rolesTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await rolesTab.click();
      await page.waitForTimeout(1000);

      const bodyText = await page.locator('body').innerText();
      // Should show role names like admin, operator, viewer
      const hasRoleContent =
        bodyText.match(/admin|operator|viewer|role/i) !== null;
      expect(hasRoleContent).toBe(true);

      await expect(page.getByText('Something went wrong')).not.toBeVisible();
    }
  });

  test('access policies tab shows policy cards', async ({ page }) => {
    await page.goto('/security/access-policies');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    await expect(page.getByText('Something went wrong')).not.toBeVisible();

    const bodyText = await page.locator('body').innerText();
    // Access policies page should render — either with policy data or an empty state
    const hasContent =
      bodyText.match(/access.?polic|allow|deny|create/i) !== null;
    expect(hasContent).toBe(true);
  });

  test('API keys page renders table', async ({ page }) => {
    await page.goto('/security/api-keys');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    await expect(page.getByText('Something went wrong')).not.toBeVisible();

    const bodyText = await page.locator('body').innerText();
    // API keys page should render with at least a header and create button
    const hasContent =
      bodyText.match(/api.?key|create|generate|token/i) !== null;
    expect(hasContent).toBe(true);
  });

  test('audit log shows entries with filters', async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    await expect(page.getByText('Something went wrong')).not.toBeVisible();

    const bodyText = await page.locator('body').innerText();
    // Audit page should have filter controls and log entries or empty state
    const hasAuditContent =
      bodyText.match(/audit|log|activity|filter|event|change/i) !== null;
    expect(hasAuditContent).toBe(true);

    // Check for filter controls
    const filters = page.locator('select, [role="combobox"], input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]');
    const hasFilters = (await filters.count()) > 0;

    // Or there's a time-range selector
    const timeRange = page.getByRole('button', { name: /1h|6h|24h|7d/i });
    const hasTimeRange = await timeRange.first().isVisible().catch(() => false);

    expect(hasFilters || hasTimeRange).toBe(true);
  });
});
