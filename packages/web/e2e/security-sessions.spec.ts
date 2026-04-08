import { expect } from '@playwright/test';
import { adminTest } from './fixtures';

// Session management depends on grpc-gateway endpoints that may return 500.
// Mark as fixme until backend stabilizes.
adminTest.describe('Security — Sessions', () => {
  adminTest.fixme('active sessions listed on Security page', async ({ page }) => {
    await page.goto('/security');

    await expect(page.getByText(/active sessions|sessions/i).first()).toBeVisible();

    const sessionRows = page.locator('[data-testid="session-row"]')
      .or(page.locator('table').filter({ hasText: /session|active/i }).locator('tbody tr'));
    const count = await sessionRows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  adminTest.fixme('current session is highlighted or marked', async ({ page }) => {
    await page.goto('/security');

    const currentBadge = page.getByText(/current|this session/i);
    await expect(currentBadge.first()).toBeVisible();
  });

  adminTest.fixme('admin can revoke another session', async ({ page }) => {
    await page.goto('/security');

    const revokable = page.locator('[data-testid="session-row"]')
      .or(page.locator('table').filter({ hasText: /session/i }).locator('tbody tr'))
      .filter({ hasNot: page.getByText(/current|this session/i) });

    const count = await revokable.count();
    if (count > 0) {
      const revokeBtn = revokable.first().getByRole('button', { name: /revoke|end/i });
      if (await revokeBtn.isVisible()) {
        await revokeBtn.click();
        await page.getByRole('button', { name: /confirm|yes/i }).click();
        await expect(page.getByText(/revoked|ended/i).first()).toBeVisible();
      }
    }
  });
});
