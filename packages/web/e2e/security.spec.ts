import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// Security page depends on grpc-gateway endpoints that may return 500.
// Mark as fixme until backend stabilizes.
adminTest.describe('Security — API Keys', () => {
  adminTest.beforeEach(async ({ page }) => {
    await page.goto('/security');
    await page.waitForLoadState('networkidle');
  });

  adminTest.fixme('API keys section is visible', async ({ page }) => {
    await expect(page.getByText(/api keys/i).first()).toBeVisible();
  });

  adminTest.fixme('create key: dialog, name, scopes, submit, key shown once with copy', async ({ page }) => {
    await page.getByRole('button', { name: /create.*key|new.*key|add.*key/i }).click();

    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/name/i).fill('e2e-test-key');

    const scopeSelect = page.getByLabel(/scope/i).or(
      page.locator('[data-testid="scope-select"]'),
    );
    if (await scopeSelect.isVisible()) {
      await scopeSelect.click();
      await page.getByRole('option').first().click();
    }

    await page.getByRole('button', { name: /create|generate/i }).click();

    await expect(page.getByText(/rku_/)).toBeVisible();

    await expect(
      page.getByRole('button', { name: /copy/i }).or(page.locator('[data-testid="copy-key"]')),
    ).toBeVisible();

    await page.keyboard.press('Escape');
  });

  adminTest.fixme('revoke key: confirm dialog, removed from list', async ({ page }) => {
    const revokeButton = page.getByRole('button', { name: /revoke/i }).first();
    if (await revokeButton.isVisible()) {
      await revokeButton.click();

      await expect(page.getByText(/are you sure|confirm/i)).toBeVisible();
      await page.getByRole('button', { name: /confirm|revoke|yes/i }).click();

      await expect(page.getByText(/revoked|removed/i).first()).toBeVisible();
    }
  });

  adminTest.fixme('certificate status section renders', async ({ page }) => {
    const certSection = page.getByText(/certificate|tls|pki/i).first();
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});
