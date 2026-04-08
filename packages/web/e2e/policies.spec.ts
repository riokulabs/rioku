import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// Policy management depends on grpc-gateway endpoints that currently return 500.
// Mark as fixme until backend stabilizes.
adminTest.describe('Policy Management', () => {
  adminTest.beforeEach(async ({ page }) => {
    await page.goto('/config/policies');
    await page.waitForLoadState('networkidle');
  });

  adminTest.fixme('list shows seeded policies', async ({ page }) => {
    const table = page.locator('table').or(page.locator('[data-testid="data-table"]'));
    await expect(table).toBeVisible();
  });

  adminTest.fixme('create policy: name, type, JSON config, save, appears', async ({ page }) => {
    await page.getByRole('button', { name: /add|create|new/i }).click();

    await page.getByLabel(/name/i).first().fill('e2e-test-policy');

    const typeSelect = page.getByLabel(/type/i).or(
      page.locator('[data-testid="policy-type-select"]'),
    );
    if (await typeSelect.isVisible()) {
      await typeSelect.click();
      await page.getByRole('option', { name: /rate-limit/i }).click();
    }

    const configArea = page.getByLabel(/config/i).or(page.locator('textarea').first());
    if (await configArea.isVisible()) {
      await configArea.fill('{"requests_per_second": 100}');
    }

    await page.getByRole('button', { name: /save|create/i }).click();

    await expect(page.getByText(/created|saved/i).first()).toBeVisible();
    await expect(page.getByText('e2e-test-policy')).toBeVisible();
  });

  adminTest.fixme('edit policy: modify config JSON, save, reflected', async ({ page }) => {
    const row = page.locator('tbody tr').first();
    await row.getByRole('button', { name: /more|actions/i }).or(row.locator('[data-testid="row-actions"]')).click();
    await page.getByRole('menuitem', { name: /edit/i }).click();

    const configArea = page.getByLabel(/config/i).or(page.locator('textarea').first());
    if (await configArea.isVisible()) {
      await configArea.clear();
      await configArea.fill('{"requests_per_second": 200}');
    }

    await page.getByRole('button', { name: /save|update/i }).click();
    await expect(page.getByText(/updated|saved/i).first()).toBeVisible();
  });

  adminTest.fixme('delete policy: confirm, removed', async ({ page }) => {
    await page.getByRole('button', { name: /add|create|new/i }).click();
    await page.getByLabel(/name/i).first().fill('e2e-delete-policy');

    const typeSelect = page.getByLabel(/type/i).or(
      page.locator('[data-testid="policy-type-select"]'),
    );
    if (await typeSelect.isVisible()) {
      await typeSelect.click();
      await page.getByRole('option').first().click();
    }

    await page.getByRole('button', { name: /save|create/i }).click();
    await expect(page.getByText('e2e-delete-policy')).toBeVisible();

    const row = page.getByText('e2e-delete-policy').locator('..');
    await row.getByRole('button', { name: /more|actions/i }).or(row.locator('[data-testid="row-actions"]')).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    await page.getByRole('button', { name: /confirm|delete|yes/i }).click();

    await expect(page.getByText(/deleted|removed/i).first()).toBeVisible();
    await expect(page.getByText('e2e-delete-policy')).not.toBeVisible();
  });
});
