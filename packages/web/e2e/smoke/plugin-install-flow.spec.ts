/**
 * E2E smoke — plugin install flow (Plan 6, Task 6c.8).
 *
 * Covers the streaming install pipeline introduced in Plan 6:
 *   - Marketplace tab renders and surfaces Install buttons on listing cards.
 *   - Install click opens <InstallApprovalModal>. If the candidate declares
 *     admin-level permissions (e.g. `<slug>:write`), the modal requires a
 *     second-confirm checkbox; the mock marketplace→approval adapter in
 *     `routes/t.$tenant/plugins.tsx` synthesises `<slug>:read` + `<slug>:write`
 *     for every listing, and `:write` is treated as admin-level — so the
 *     checkbox is always present in practice. The test ticks it when visible.
 *   - Approve hands off to <InstallProgressModal>, which drives 4 stage badges
 *     (Fetching → Verifying → Building → Swapping). Mock install runs 4-8s.
 *   - Terminal: either the "Installed successfully" alert + install toast appear
 *     and the modal auto-closes to the Installed tab, or — for refs the seed
 *     deterministically fails — we accept the failure alert as a valid outcome.
 *
 * Selecting the marketplace ref:
 *   `installPluginWithProgress` fails deterministically when
 *   `hashRef(reference) % 10 === 0`. `marketplace:com.rioku.jwt-auth` hashes
 *   to 5 so it always succeeds — see the hashRef/shouldFail helpers in
 *   packages/web/src/features/plugins/installed/api.ts. We pin that listing
 *   so this spec is deterministic.
 *
 * Timing note:
 *   Install takes ~4-8 seconds across 12 ticks. We use Playwright's built-in
 *   retry timeouts (toBeVisible with timeout) to poll rather than sleeping.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

// A marketplace listing whose reference hashes to a non-zero bucket mod 10 so
// installPluginWithProgress does NOT flip the deterministic-failure bit.
// See hashRef/shouldFail in features/plugins/installed/api.ts.
const SUCCESS_SLUG = 'com.rioku.jwt-auth';
const SUCCESS_DISPLAY_NAME = 'JWT Auth';

test('marketplace tab renders Install buttons on listing cards', async ({ authedPage: page }) => {
  await page.goto('/t/acme/plugins?tab=marketplace');

  await expect(page.getByRole('heading', { name: /^plugins$/i })).toBeVisible();

  // Marketplace listings seeded by mock-seed.ts — at least the jwt-auth card
  // should be in the DOM.
  const card = page.getByTestId(`marketplace-listing-${SUCCESS_SLUG}`);
  await expect(card).toBeVisible({ timeout: 10_000 });

  // Every card has an "Install" button.
  await expect(card.getByRole('button', { name: /^install$/i })).toBeVisible();
});

test('install from marketplace streams progress and reaches a terminal state', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/plugins?tab=marketplace');

  const card = page.getByTestId(`marketplace-listing-${SUCCESS_SLUG}`);
  await expect(card).toBeVisible({ timeout: 10_000 });

  // Click the Install button → approval modal opens.
  await card.getByRole('button', { name: /^install$/i }).click();

  // Approval modal
  const approvalTitle = page.getByText(/^review plugin install$/i);
  await expect(approvalTitle).toBeVisible({ timeout: 5_000 });

  // The marketplace→approval adapter synthesises `<slug>:write` declared
  // permissions, which `isAdminLevelPermission` flags as admin-tier and
  // requires the second-confirm checkbox. Tick it if visible.
  const secondConfirm = page.getByRole('checkbox', {
    name: /admin-level permissions/i,
  });
  if ((await secondConfirm.count()) > 0) {
    await secondConfirm.check();
  }

  // Approve → streaming progress modal opens.
  await page.getByRole('button', { name: /approve & install/i }).click();

  // Progress modal title contains the display name.
  await expect(page.getByText(new RegExp(`installing ${SUCCESS_DISPLAY_NAME}`, 'i'))).toBeVisible({
    timeout: 5_000,
  });

  // All 4 stage badges appear at least in the disabled/gray state from the first tick.
  for (const stage of ['fetching', 'verifying', 'building', 'swapping']) {
    await expect(page.getByTestId(`install-progress-stage-${stage}`)).toBeVisible({
      timeout: 5_000,
    });
  }

  // Wait for a terminal state: either the success alert, the install toast,
  // or the failure alert. Total install duration is 4-8s; we allow 15s.
  const successAlert = page.getByText(/installed successfully/i);
  const installToast = page.getByText(/^plugin installed$/i);
  const failureAlert = page.getByText(/install failed during/i);

  await expect(async () => {
    const [succ, toast, fail] = await Promise.all([
      successAlert.count(),
      installToast.count(),
      failureAlert.count(),
    ]);
    expect(succ + toast + fail).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });

  // If the install deterministically fails (shouldn't for jwt-auth, but keep
  // the spec tolerant to future ref-hash drift), accept that outcome.
  const didFail = (await failureAlert.count()) > 0;
  if (didFail) {
    // Stage strip shows the red stage for the failure point — any of the 4
    // stage badges must still be mounted.
    const anyStage = page.getByTestId(/^install-progress-stage-/);
    expect(await anyStage.count()).toBeGreaterThan(0);
    return;
  }

  // Success path: progress modal auto-closes after the 1.5s dwell and the
  // route auto-navigates to the Installed tab. The new plugin should appear
  // on the Installed tab.
  await expect(page.getByRole('tab', { name: /^installed$/i, selected: true })).toBeVisible({
    timeout: 10_000,
  });

  // The installed list surfaces the new plugin's slug (mono subtext under
  // the display name). Assert by slug to avoid name-vs-marketplace diffs.
  await expect(page.getByText(SUCCESS_SLUG, { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
});

test('install approval cancel returns user to the marketplace without installing', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/plugins?tab=marketplace');

  const card = page.getByTestId(`marketplace-listing-${SUCCESS_SLUG}`);
  await expect(card).toBeVisible({ timeout: 10_000 });

  await card.getByRole('button', { name: /^install$/i }).click();

  await expect(page.getByText(/^review plugin install$/i)).toBeVisible();

  await page.getByRole('button', { name: /^decline$/i }).click();

  // Approval modal dismissed; we're still on the marketplace tab.
  await expect(page.getByText(/^review plugin install$/i)).not.toBeVisible();
  await expect(card).toBeVisible();
});
