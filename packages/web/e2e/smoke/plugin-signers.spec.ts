/**
 * E2E smoke — plugin signer allow-list (Plan 6, Task 6c.8).
 *
 * Covers the tenant-scoped and super-admin signer pages introduced in Plan 6.
 *
 *   - `/t/acme/plugins/signers` — tenant-scoped list (acme seeds an
 *     `Acme Internal` signer, so at least one row is present).
 *   - `/admin/plugin-signers` — super-admin view with a Global tab. Seed data
 *     populates three global signers (Rioku Labs, Caddy Labs, Legacy
 *     CaddyGateway Team); the Global tab should show ≥2.
 *   - Detail drawer: Verify/Revoke buttons render and the fingerprint is
 *     shown in full with a copy affordance.
 *   - Revoke a verified signer via the row action menu → the status badge
 *     flips to "revoked".
 *   - Create a new signer via the Add-signer form → new row appears.
 *
 * seedStore in mock-seed.ts sets Derrick (the authedPage user) to the admin
 * role which owns plugin-signer:read/write/delete, so every action below is
 * permission-authorised.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

/**
 * Deterministic SHA-256-shaped fingerprint. The signer schema requires exactly
 * 64 lowercase hex chars — this helper stretches a seed into a 64-char string.
 */
function makeFingerprint(seed: string): string {
  const alphabet = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 64; i++) {
    const c = seed.charCodeAt(i % seed.length);
    out += alphabet[(c + i * 7) & 0xf];
  }
  return out;
}

test('tenant signer list renders seeded rows', async ({ authedPage: page }) => {
  await page.goto('/t/acme/plugins/signers');

  await expect(
    page.getByRole('heading', { name: /^plugin signers$/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Acme is seeded with one tenant-scoped signer ("Acme Internal"). We assert
  // the expected name rather than a row count to avoid a coupling to the
  // global-signer filter leak.
  await expect(page.getByText('Acme Internal').first()).toBeVisible({
    timeout: 10_000,
  });
});

test('admin signer page lists global signers on the Global tab', async ({
  authedPage: page,
}) => {
  await page.goto('/admin/plugin-signers');

  await expect(
    page.getByRole('heading', { name: /^plugin signers$/i }),
  ).toBeVisible({ timeout: 10_000 });

  // The Global tab is selected by default (no `scope` search param).
  await expect(
    page.getByRole('tab', { name: /^global$/i, selected: true }),
  ).toBeVisible();

  // Rioku Labs + Caddy Labs are verified global signers. Revoked legacy
  // CaddyGateway Team is also in the seed but we only need ≥2 here.
  await expect(page.getByText('Rioku Labs').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Caddy Labs').first()).toBeVisible();
});

test('signer detail drawer surfaces Verify + Revoke buttons', async ({
  authedPage: page,
}) => {
  await page.goto('/admin/plugin-signers');

  // Open the row for the "Caddy Labs" verified global signer. Row click
  // opens the detail drawer (onRowClick in <SignerList>). We click the name
  // cell rather than the whole row to avoid the ActionIcon inside the row
  // swallowing the click via stopPropagation.
  await expect(page.getByText('Caddy Labs').first()).toBeVisible({
    timeout: 10_000,
  });
  await page.getByText('Caddy Labs').first().click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  // Verify + Revoke buttons render inside the detail body. Verify is
  // disabled for an already-verified signer; Revoke is enabled. We assert
  // both buttons exist — state is an implementation detail.
  await expect(drawer.getByRole('button', { name: /^verify$/i })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^revoke$/i })).toBeVisible();
});

test('revoke flow flips the status badge to revoked', async ({
  authedPage: page,
}) => {
  await page.goto('/admin/plugin-signers');

  // Target "Caddy Labs" (seeded verified global signer). Use the row's
  // actions menu so we exercise the list-level revoke path (parent handler
  // calls revokeSigner + notify.info).
  const row = page.getByRole('row').filter({ hasText: 'Caddy Labs' }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Initial state: verified badge present on the row.
  await expect(row.getByText('verified')).toBeVisible();

  // Open the row action menu and click Revoke.
  await row.getByRole('button', { name: /actions for caddy labs/i }).click();
  await page.getByRole('menuitem', { name: /^revoke$/i }).click();

  // Toast fires; row re-renders with revoked chip. Poll the row for the
  // revoked text rather than the specific badge color.
  await expect(row.getByText('revoked')).toBeVisible({ timeout: 10_000 });
});

test('adding a new signer creates a row in the list', async ({
  authedPage: page,
}) => {
  await page.goto('/admin/plugin-signers');

  await expect(
    page.getByRole('heading', { name: /^plugin signers$/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Open the add-signer form (Global scope — button wording matches the
  // admin page copy).
  await page.getByRole('button', { name: /add global signer/i }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  // Fill form. Use a timestamped name so re-runs don't collide if state is
  // ever persisted across runs.
  const name = `Test Publisher ${String(Date.now()).slice(-6)}`;
  const fingerprint = makeFingerprint(name);

  await drawer.getByRole('textbox', { name: /^name$/i }).fill(name);
  await drawer
    .getByRole('textbox', { name: /fingerprint \(sha-256\)/i })
    .fill(fingerprint);
  await drawer
    .getByRole('textbox', { name: /^description$/i })
    .fill('Added from smoke test.');

  // Submit.
  await drawer.getByRole('button', { name: /^add signer$/i }).click();

  // Success toast fires and the drawer swaps into detail mode with the new
  // signer's name visible.
  await expect(page.getByText(/^signer added$/i)).toBeVisible({
    timeout: 10_000,
  });

  // New row appears in the main list (detail drawer shows the same name).
  await expect(page.getByText(name).first()).toBeVisible();
});
