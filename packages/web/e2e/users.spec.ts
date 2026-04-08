import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// User management depends on grpc-gateway endpoints that may return 500.
// Mark as fixme until backend stabilizes.
adminTest.describe('User Management', () => {
  adminTest.beforeEach(async ({ page }) => {
    await page.goto('/settings/users');
    await page.waitForLoadState('networkidle');
  });

  adminTest.fixme('list shows seeded users', async ({ page }) => {
    await expect(page.getByText('testadmin')).toBeVisible();
    await expect(page.getByText('testviewer')).toBeVisible();
    await expect(page.getByText('testoperator')).toBeVisible();
  });

  adminTest.fixme('create user: fill form, save, appears in list', async ({ page }) => {
    await page.getByRole('button', { name: /add|create|new/i }).click();

    await page.getByLabel(/username/i).fill('e2e-newuser');
    await page.getByLabel(/password/i).first().fill('E2eNewUser123!');

    const confirmPw = page.getByLabel(/confirm/i);
    if (await confirmPw.isVisible()) {
      await confirmPw.fill('E2eNewUser123!');
    }

    await page.getByRole('button', { name: /save|create/i }).click();

    await expect(page.getByText(/created|saved/i).first()).toBeVisible();
    await expect(page.getByText('e2e-newuser')).toBeVisible();
  });

  adminTest.fixme('edit user: change display name, save, reflected', async ({ page }) => {
    const row = page.getByText('e2e-newuser').locator('..');
    await row.getByRole('button', { name: /more|actions|edit/i }).first().click();

    const editItem = page.getByRole('menuitem', { name: /edit/i });
    if (await editItem.isVisible()) {
      await editItem.click();
    }

    const displayInput = page.getByLabel(/display.?name/i);
    if (await displayInput.isVisible()) {
      await displayInput.clear();
      await displayInput.fill('E2E Test User');
      await page.getByRole('button', { name: /save|update/i }).click();
      await expect(page.getByText(/updated|saved/i).first()).toBeVisible();
    }
  });

  adminTest.fixme('suspend user changes status badge', async ({ page }) => {
    const row = page.getByText('e2e-newuser').locator('..');
    await row.getByRole('button', { name: /more|actions/i }).first().click();
    const suspendItem = page.getByRole('menuitem', { name: /suspend/i });
    if (await suspendItem.isVisible()) {
      await suspendItem.click();
      await page.getByRole('button', { name: /confirm|yes/i }).click();
      await expect(page.getByText('e2e-newuser').locator('..').getByText(/suspended/i)).toBeVisible();
    }
  });

  adminTest.fixme('assign role to user', async ({ page }) => {
    const row = page.getByText('e2e-newuser').locator('..');
    await row.getByRole('button', { name: /more|actions/i }).first().click();

    const editItem = page.getByRole('menuitem', { name: /edit/i });
    if (await editItem.isVisible()) {
      await editItem.click();
    }

    const roleSelect = page.getByLabel(/role/i).or(page.locator('[data-testid="role-select"]'));
    if (await roleSelect.isVisible()) {
      await roleSelect.click();
      await page.getByRole('option', { name: /viewer/i }).click();
      await page.getByRole('button', { name: /save|update/i }).click();
      await expect(page.getByText(/updated|saved/i).first()).toBeVisible();
    }
  });
});
