/**
 * Stage-2 settings sub-route flow — Plan 07.
 *
 * Tagged @isolated: runs against the sandbox (or seeded mock-fallback when
 * sandbox is unavailable). Walks through each settings sub-route and the
 * danger-zone triple-confirm without actually performing the destructive
 * action.
 *
 * Plan 07 — Task: Playwright E2E.
 */
import { expect, type Page } from '@playwright/test';
import { test } from '../../fixtures/auth';

async function gotoTenantSettings(page: Page, slug: string, sub?: string): Promise<void> {
  const path = sub ? `/t/${slug}/settings/${sub}` : `/t/${slug}/settings`;
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
}

test.describe('@isolated stage-2 settings sub-routes', () => {
  test('navigates to each settings sub-route', async ({ authedPage }) => {
    const subroutes = [
      'profile',
      'tenant',
      'auth-policy',
      'network',
      'tls',
      'pki',
      'observability',
      'integrations',
      'danger',
    ];
    for (const sub of subroutes) {
      await gotoTenantSettings(authedPage, 'acme', sub);
      // The page wrapper testid is `settings-<slug>-page`; some routes use
      // hyphenated slugs (e.g. auth-policy).
      const wrapperId = `settings-${sub}-page`;
      const wrapper = authedPage.getByTestId(wrapperId);
      await expect(wrapper).toBeVisible({ timeout: 10_000 });
    }
  });

  test('danger zone triple-confirm gates the submit button', async ({ authedPage }) => {
    await gotoTenantSettings(authedPage, 'acme', 'danger');
    await expect(authedPage.getByTestId('danger-zone-real-section')).toBeVisible({
      timeout: 10_000,
    });

    // Open the hard-reset modal. The Mantine Modal root has the
    // `danger-real-reset-modal` testid but Mantine wraps it in a
    // positioned overlay container with `display: contents` semantics
    // that Playwright's visibility heuristic reads as hidden — assert
    // on the step-1 alert (which IS in the visible flow) as the
    // proxy "modal mounted" signal.
    await authedPage.getByTestId('danger-real-reset-open').click();
    await expect(authedPage.getByTestId('danger-real-reset-step-1')).toBeVisible();

    const submit = authedPage.getByTestId('danger-real-reset-submit');
    await expect(submit).toBeDisabled();

    // Type magic word — still disabled (checkbox unchecked).
    await authedPage.getByTestId('danger-real-reset-word-input').fill('RESET');
    await expect(submit).toBeDisabled();

    // Tick the acknowledgement — submit becomes enabled.
    await authedPage.getByTestId('danger-real-reset-ack').check();
    await expect(submit).toBeEnabled();

    // Cancel without submitting — destructive action NOT performed.
    await authedPage.getByTestId('danger-real-reset-cancel').click();
    await expect(authedPage.getByTestId('danger-real-reset-step-1')).toBeHidden();
  });
});
