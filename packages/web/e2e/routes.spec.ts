import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// Route management depends on grpc-gateway ListRoutes/CreateRoute endpoints.
// These currently return 500 for streaming RPCs. Mark as fixme.
adminTest.describe('Route Management', () => {
  adminTest.beforeEach(async ({ page }) => {
    await page.goto('/config/routes');
    await page.waitForLoadState('networkidle');
  });

  adminTest.fixme('list shows seeded routes', async ({ page }) => {
    await expect(page.getByText('users-api')).toBeVisible();
    await expect(page.getByText('products-api')).toBeVisible();
  });

  adminTest.fixme('search filters table by name', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search|filter/i);
    await searchInput.fill('users');

    await expect(page.getByText('users-api')).toBeVisible();
    await expect(page.getByText('products-api')).not.toBeVisible();
  });

  adminTest.fixme('create route: form fills and saves, appears in list with toast', async ({ page }) => {
    await page.getByRole('button', { name: /add|create|new/i }).click();

    await page.getByLabel(/name/i).first().fill('e2e-test-route');
    await page.getByLabel(/host/i).fill('test.local');
    await page.getByLabel(/path/i).fill('/e2e/*');

    const serviceSelect = page.locator('[data-testid="target-service-select"]')
      .or(page.getByLabel(/service/i));
    if (await serviceSelect.isVisible()) {
      await serviceSelect.click();
      await page.getByRole('option').first().click();
    }

    await page.getByRole('button', { name: /save|create/i }).click();

    await expect(page.getByText(/created|saved/i).first()).toBeVisible();
    await expect(page.getByText('e2e-test-route')).toBeVisible();
  });

  adminTest.fixme('edit route: modify name and save, change reflected', async ({ page }) => {
    const row = page.getByText('users-api').locator('..');
    await row.getByRole('button', { name: /more|actions/i }).or(row.locator('[data-testid="row-actions"]')).click();
    await page.getByRole('menuitem', { name: /edit/i }).click();

    const nameInput = page.getByLabel(/name/i).first();
    await nameInput.clear();
    await nameInput.fill('users-api-edited');

    await page.getByRole('button', { name: /save|update/i }).click();

    await expect(page.getByText(/updated|saved/i).first()).toBeVisible();
    await expect(page.getByText('users-api-edited')).toBeVisible();

    // Restore original name
    const editedRow = page.getByText('users-api-edited').locator('..');
    await editedRow.getByRole('button', { name: /more|actions/i }).or(editedRow.locator('[data-testid="row-actions"]')).click();
    await page.getByRole('menuitem', { name: /edit/i }).click();
    const restoreInput = page.getByLabel(/name/i).first();
    await restoreInput.clear();
    await restoreInput.fill('users-api');
    await page.getByRole('button', { name: /save|update/i }).click();
  });

  adminTest.fixme('delete route: confirmation dialog, removed from list with toast', async ({ page }) => {
    // First create a throwaway route
    await page.getByRole('button', { name: /add|create|new/i }).click();
    await page.getByLabel(/name/i).first().fill('e2e-delete-me');
    await page.getByLabel(/host/i).fill('delete.local');
    await page.getByLabel(/path/i).fill('/delete/*');

    const serviceSelect = page.locator('[data-testid="target-service-select"]')
      .or(page.getByLabel(/service/i));
    if (await serviceSelect.isVisible()) {
      await serviceSelect.click();
      await page.getByRole('option').first().click();
    }

    await page.getByRole('button', { name: /save|create/i }).click();
    await expect(page.getByText('e2e-delete-me')).toBeVisible();

    // Now delete it
    const row = page.getByText('e2e-delete-me').locator('..');
    await row.getByRole('button', { name: /more|actions/i }).or(row.locator('[data-testid="row-actions"]')).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    // Confirmation dialog
    await expect(page.getByText(/are you sure|confirm/i)).toBeVisible();
    await page.getByRole('button', { name: /confirm|delete|yes/i }).click();

    // Toast
    await expect(page.getByText(/deleted|removed/i).first()).toBeVisible();

    // Gone from list
    await expect(page.getByText('e2e-delete-me')).not.toBeVisible();
  });
});
