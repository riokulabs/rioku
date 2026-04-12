import { test as setup, expect } from '@playwright/test';

const authFile = 'e2e/.auth/user.json';

setup('authenticate as root', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Username').fill('root');
  await page.getByLabel('Password').fill('TestRoot1234!');
  await page.getByRole('button', { name: /log in/i }).click();

  // Wait for redirect to dashboard (or change-password for first-time root)
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 15_000,
  });

  // If redirected to change-password, handle it
  if (page.url().includes('/change-password')) {
    // Fill in whatever the change-password form requires and submit
    const newPwField = page.getByLabel(/new password/i).first();
    const confirmPwField = page.getByLabel(/confirm/i).first();
    if (await newPwField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newPwField.fill('TestRoot1234!');
      if (await confirmPwField.isVisible().catch(() => false)) {
        await confirmPwField.fill('TestRoot1234!');
      }
      await page.getByRole('button', { name: /change|save|submit/i }).click();
      await page.waitForURL('/', { timeout: 10_000 });
    }
  }

  // Verify we're on the dashboard
  await expect(page).toHaveURL('/');

  await page.context().storageState({ path: authFile });
});
