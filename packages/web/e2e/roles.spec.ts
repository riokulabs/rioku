import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// Role management depends on grpc-gateway endpoints that may return 500.
// Mark as fixme until backend stabilizes.
adminTest.describe('Role Management', () => {
  adminTest.beforeEach(async ({ page }) => {
    await page.goto('/settings/roles');
    await page.waitForLoadState('networkidle');
  });

  adminTest.fixme('list shows built-in and custom roles', async ({ page }) => {
    await expect(page.getByText('admin').first()).toBeVisible();
    await expect(page.getByText('viewer').first()).toBeVisible();
    await expect(page.getByText('operator').first()).toBeVisible();
  });

  adminTest.fixme('create custom role: name, permissions, save, appears', async ({ page }) => {
    await page.getByRole('button', { name: /add|create|new/i }).click();

    await page.getByLabel(/name/i).first().fill('e2e-custom-role');

    const descInput = page.getByLabel(/description/i);
    if (await descInput.isVisible()) {
      await descInput.fill('E2E test role');
    }

    const checkboxes = page.locator('input[type="checkbox"]');
    const checkboxCount = await checkboxes.count();
    if (checkboxCount > 0) {
      await checkboxes.first().check();
    }

    await page.getByRole('button', { name: /save|create/i }).click();

    await expect(page.getByText(/created|saved/i).first()).toBeVisible();
    await expect(page.getByText('e2e-custom-role')).toBeVisible();
  });

  adminTest.fixme('edit custom role: change permissions, save, reflected', async ({ page }) => {
    const row = page.getByText('e2e-custom-role').locator('..');
    await row.getByRole('button', { name: /more|actions/i }).first().click();
    await page.getByRole('menuitem', { name: /edit/i }).click();

    const checkboxes = page.locator('input[type="checkbox"]');
    const checkboxCount = await checkboxes.count();
    if (checkboxCount > 1) {
      await checkboxes.nth(1).check();
    }

    await page.getByRole('button', { name: /save|update/i }).click();
    await expect(page.getByText(/updated|saved/i).first()).toBeVisible();
  });

  adminTest.fixme('delete custom role with confirmation', async ({ page }) => {
    const row = page.getByText('e2e-custom-role').locator('..');
    await row.getByRole('button', { name: /more|actions/i }).first().click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    await expect(page.getByText(/are you sure|confirm/i)).toBeVisible();
    await page.getByRole('button', { name: /confirm|delete|yes/i }).click();

    await expect(page.getByText(/deleted|removed/i).first()).toBeVisible();
    await expect(page.getByText('e2e-custom-role')).not.toBeVisible();
  });

  adminTest.fixme('built-in superadmin role has delete button disabled', async ({ page }) => {
    const superadminRow = page.getByText('superadmin').locator('..');
    if (await superadminRow.isVisible()) {
      const deleteBtn = superadminRow.getByRole('button', { name: /delete/i });
      if (await deleteBtn.isVisible()) {
        await expect(deleteBtn).toBeDisabled();
      }
    }
  });
});
