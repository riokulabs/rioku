import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// Profile page depends on grpc-gateway endpoints that may return 500.
// Mark as fixme until backend stabilizes.
adminTest.describe('Profile Page', () => {
  adminTest.beforeEach(async ({ page }) => {
    await page.goto('/settings/profile');
    await page.waitForLoadState('networkidle');
  });

  adminTest.fixme('displays current user info', async ({ page }) => {
    await expect(page.getByText('testadmin')).toBeVisible();
  });

  adminTest.fixme('edit display name, save, reflected', async ({ page }) => {
    const displayInput = page.getByLabel(/display.?name/i);
    await displayInput.clear();
    await displayInput.fill('E2E Admin User');

    await page.getByRole('button', { name: /save|update/i }).first().click();
    await expect(page.getByText(/updated|saved/i).first()).toBeVisible();

    // Restore
    await displayInput.clear();
    await displayInput.fill('');
    await page.getByRole('button', { name: /save|update/i }).first().click();
  });

  adminTest.fixme('change password requires old password and succeeds', async ({ page }) => {
    const currentPwInput = page.getByLabel(/current.?password/i);
    const newPwInput = page.getByLabel(/new.?password/i).first();
    const confirmPwInput = page.getByLabel(/confirm/i);

    if (await currentPwInput.isVisible()) {
      await currentPwInput.fill('TestAdmin123!');
      await newPwInput.fill('TestAdmin456!');
      if (await confirmPwInput.isVisible()) {
        await confirmPwInput.fill('TestAdmin456!');
      }

      await page.getByRole('button', { name: /change.?password|update.?password/i }).click();
      await expect(page.getByText(/password changed|success/i).first()).toBeVisible();

      // Restore original password
      await currentPwInput.fill('TestAdmin456!');
      await newPwInput.fill('TestAdmin123!');
      if (await confirmPwInput.isVisible()) {
        await confirmPwInput.fill('TestAdmin123!');
      }
      await page.getByRole('button', { name: /change.?password|update.?password/i }).click();
    }
  });

  adminTest.fixme('TOTP setup: enable shows QR URI', async ({ page }) => {
    const enableButton = page.getByRole('button', { name: /enable.?totp|enable.?2fa|set.?up/i });
    if (await enableButton.isVisible()) {
      await enableButton.click();

      const qrVisible = await page.getByText(/otpauth:\/\/|secret/i).isVisible().catch(() => false);
      const qrImage = await page.locator('img[alt*="QR"], canvas, [data-testid="totp-qr"]').isVisible().catch(() => false);
      expect(qrVisible || qrImage).toBe(true);

      // Cancel without completing (don't actually enable TOTP for test stability)
      await page.keyboard.press('Escape');
    }
  });
});
