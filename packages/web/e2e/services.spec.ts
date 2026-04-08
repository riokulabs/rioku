import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// Service management depends on grpc-gateway ListServices/CreateService endpoints.
// These currently return 500 for streaming RPCs. Mark as fixme.
adminTest.describe('Service Management', () => {
  adminTest.beforeEach(async ({ page }) => {
    await page.goto('/config/services');
    await page.waitForLoadState('networkidle');
  });

  adminTest.fixme('list shows seeded services', async ({ page }) => {
    const table = page.locator('table').or(page.locator('[data-testid="data-table"]'));
    await expect(table).toBeVisible();
    const rows = table.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  adminTest.fixme('create service: name, LB policy, upstream rows, save, appears', async ({ page }) => {
    await page.getByRole('button', { name: /add|create|new/i }).click();

    await page.getByLabel(/name/i).first().fill('e2e-test-service');

    const lbSelect = page.getByLabel(/load.?balanc|lb.?policy/i).or(
      page.locator('[data-testid="lb-policy-select"]'),
    );
    if (await lbSelect.isVisible()) {
      await lbSelect.click();
      await page.getByRole('option', { name: /round-robin/i }).click();
    }

    const upstreamInput = page.getByLabel(/address|upstream/i).first()
      .or(page.getByPlaceholder(/address|host:port/i).first());
    if (await upstreamInput.isVisible()) {
      await upstreamInput.fill('localhost:9099');
    }

    await page.getByRole('button', { name: /save|create/i }).click();

    await expect(page.getByText(/created|saved/i).first()).toBeVisible();
    await expect(page.getByText('e2e-test-service')).toBeVisible();
  });

  adminTest.fixme('edit service: modify LB policy, save, reflected', async ({ page }) => {
    const row = page.locator('tbody tr').first();
    await row.getByRole('button', { name: /more|actions/i }).or(row.locator('[data-testid="row-actions"]')).click();
    await page.getByRole('menuitem', { name: /edit/i }).click();

    const lbSelect = page.getByLabel(/load.?balanc|lb.?policy/i).or(
      page.locator('[data-testid="lb-policy-select"]'),
    );
    if (await lbSelect.isVisible()) {
      await lbSelect.click();
      await page.getByRole('option', { name: /random/i }).click();
    }

    await page.getByRole('button', { name: /save|update/i }).click();
    await expect(page.getByText(/updated|saved/i).first()).toBeVisible();
  });

  adminTest.fixme('delete service with confirmation', async ({ page }) => {
    // Create then delete
    await page.getByRole('button', { name: /add|create|new/i }).click();
    await page.getByLabel(/name/i).first().fill('e2e-delete-svc');
    const upstreamInput = page.getByLabel(/address|upstream/i).first()
      .or(page.getByPlaceholder(/address|host:port/i).first());
    if (await upstreamInput.isVisible()) {
      await upstreamInput.fill('localhost:9098');
    }
    await page.getByRole('button', { name: /save|create/i }).click();
    await expect(page.getByText('e2e-delete-svc')).toBeVisible();

    const row = page.getByText('e2e-delete-svc').locator('..');
    await row.getByRole('button', { name: /more|actions/i }).or(row.locator('[data-testid="row-actions"]')).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    await expect(page.getByText(/are you sure|confirm/i)).toBeVisible();
    await page.getByRole('button', { name: /confirm|delete|yes/i }).click();

    await expect(page.getByText(/deleted|removed/i).first()).toBeVisible();
    await expect(page.getByText('e2e-delete-svc')).not.toBeVisible();
  });
});
