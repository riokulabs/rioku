/**
 * E2E smoke tests for the Settings page — Plan 8 Task 8d.16.
 *
 * Coverage:
 *   1. Rapid navigation through all 11 settings sections via the sidebar
 *      NavLink for each slug; URL search param ?section=<slug> updates.
 *   2. Profile form — save a new display name; toast confirms the change.
 *   3. TLS upload modal — open "Upload certificate", fill domain + PEM
 *      textareas, submit; success toast confirms; new row appears in table.
 *   4. Danger-zone export — click "Export tenant JSON"; Playwright download
 *      event fires and the filename matches the expected pattern.
 *
 * All tests use the authedPage fixture (Derrick, super-admin, acme tenant).
 * Mantine notification toasts render as role="alert" — we use that stable
 * selector to confirm save operations succeeded.
 *
 * Pre-existing failures in plugin-dev-sideload.spec.ts (Plan 9 scope) are
 * unrelated to this file.
 */
import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Navigate to a settings URL and wait for the mock store to reseed with
 * Derrick's session. The authedPage fixture's addInitScript clears
 * localStorage on every goto, so the store re-seeds on each navigation — we
 * must wait for currentUserId to become non-null before asserting page content.
 */
async function gotoSettings(
  page: Page,
  url: string,
): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(
    () => {
      const store = (
        window as unknown as {
          __RIOKU_STORE?: {
            getState: () => { currentUserId: string | null };
          };
        }
      ).__RIOKU_STORE;
      if (!store) return false;
      return store.getState().currentUserId !== null;
    },
    null,
    { timeout: 15_000 },
  );
}

/** All 11 settings sections in sidebar order. */
const SECTIONS = [
  'profile',
  'tenant',
  'authentication',
  'notifications',
  'network',
  'pki',
  'tls',
  'observability',
  'integrations',
  'plugins',
  'danger-zone',
] as const;

/**
 * A stable element that each section renders when fully loaded.
 * Used to confirm that clicking the NavLink actually switched content.
 * Mapped from the data-testid grep of each section file.
 */
const SECTION_ANCHOR: Record<string, string> = {
  profile: 'profile-section',
  tenant: 'tenant-section',
  authentication: 'auth-policy-form',
  // Notifications section renders a button to "Open notifications" rather
  // than an inline section component — check for the open-link testid.
  notifications: 'settings-section-open-notifications',
  network: 'fieldset-listen-addresses',
  pki: 'pki-section',
  tls: 'tls-section',
  observability: 'observability-section',
  integrations: 'integrations-section',
  plugins: 'plugin-settings-section',
  'danger-zone': 'danger-zone-section',
};

// ─── Test 1: Rapid navigation ─────────────────────────────────────────────────

test('navigates through all 11 settings sections via sidebar NavLinks', async ({
  authedPage: page,
}) => {
  // Navigate with store-reseed guard — addInitScript clears localStorage on
  // every navigation so the mock store reseeds; we must wait for currentUserId.
  await gotoSettings(page, '/t/acme/settings/');

  // Wait for the settings layout to mount — the sidebar search input is
  // the earliest stable indicator.
  await expect(page.getByTestId('settings-search-input')).toBeVisible({
    timeout: 10_000,
  });

  for (const slug of SECTIONS) {
    // Click the NavLink in the sidebar.
    await page.getByTestId(`settings-nav-${slug}`).click();

    // URL search param must update to ?section=<slug>.
    await expect(page).toHaveURL(new RegExp(`[?&]section=${slug}`), {
      timeout: 5_000,
    });

    // The distinctive anchor element for this section must be visible.
    // Network and PKI sections contain Monaco or lazy chunks — give them
    // a slightly longer timeout.
    const timeout =
      slug === 'network' || slug === 'pki' || slug === 'tls' ? 15_000 : 8_000;
    const anchor = SECTION_ANCHOR[slug];
    if (anchor) {
      await expect(page.getByTestId(anchor)).toBeVisible({ timeout });
    }
  }
});

// ─── Test 2: Profile form save ────────────────────────────────────────────────

test('profile section — saves a new display name and shows a success toast', async ({
  authedPage: page,
}) => {
  await gotoSettings(page, '/t/acme/settings/?section=profile');

  // Wait for the profile section to mount.
  await expect(page.getByTestId('profile-section')).toBeVisible({
    timeout: 10_000,
  });

  // The name input is inside the personal-info sub-component.
  const nameInput = page.getByTestId('profile-name-input');
  await expect(nameInput).toBeVisible({ timeout: 5_000 });

  // Generate a unique name so we can confirm the update.
  const newName = `E2E Smoke ${String(Date.now()).slice(-6)}`;

  // Clear and type a new name — this makes the form dirty, revealing the
  // Save button. Triple-click selects all text before fill so the input is
  // fully replaced regardless of its current value.
  await nameInput.click({ clickCount: 3 });
  await nameInput.fill(newName);

  // Save button appears when the form is dirty.
  const saveBtn = page.getByTestId('profile-name-save');
  await expect(saveBtn).toBeVisible({ timeout: 5_000 });
  await saveBtn.click();

  // Mantine notifications render toasts with role="alert".
  // Wait for the "Name updated" success toast.
  await expect(
    page.getByRole('alert').filter({ hasText: /name updated/i }),
  ).toBeVisible({ timeout: 5_000 });

  // Confirm the input now shows the new name (store was updated).
  await expect(nameInput).toHaveValue(newName, { timeout: 5_000 });
});

// ─── Test 3: TLS upload modal ─────────────────────────────────────────────────

test('tls section — uploads a certificate via the upload modal', async ({
  authedPage: page,
}) => {
  await gotoSettings(page, '/t/acme/settings/?section=tls');

  // Wait for the TLS section and cert list to render.
  await expect(page.getByTestId('tls-section')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('tls-cert-list')).toBeVisible({ timeout: 8_000 });

  // Click "Upload certificate" to open the modal.
  await page.getByTestId('upload-cert-button').click();

  // Mantine Modal renders as a dialog role — use that for visibility check
  // rather than the outer wrapper div (which may be hidden via CSS even when
  // opened in headless Chromium due to portal rendering).
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Fill domain field.
  const domain = `smoke-${String(Date.now()).slice(-8)}.example.com`;
  await modal.getByTestId('upload-domain-input').fill(domain);

  // Fill certificate PEM textarea — minimal non-empty value satisfies the
  // zod schema (min(1)). A real PEM-format string prevents any visual
  // validation errors in the UI if the schema ever tightens.
  const fakeCert =
    '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsmoke\n-----END CERTIFICATE-----';
  await modal.getByTestId('cert-pem-textarea').fill(fakeCert);

  // Fill private key PEM textarea.
  const fakeKey =
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCSMOKE\n-----END PRIVATE KEY-----';
  await modal.getByTestId('key-pem-textarea').fill(fakeKey);

  // Submit the form.
  await modal.getByTestId('upload-submit-button').click();

  // Success toast must appear.
  await expect(
    page.getByRole('alert').filter({ hasText: /certificate uploaded/i }),
  ).toBeVisible({ timeout: 5_000 });

  // Modal should close automatically after a successful upload.
  await expect(modal).not.toBeVisible({ timeout: 5_000 });

  // The new domain should appear in the cert table.
  await expect(page.getByText(domain).first()).toBeVisible({ timeout: 5_000 });
});

// ─── Test 4: Danger-zone export ───────────────────────────────────────────────

test('danger-zone — "Export tenant JSON" triggers a file download', async ({
  authedPage: page,
}) => {
  await gotoSettings(page, '/t/acme/settings/?section=danger-zone');

  // Wait for the danger-zone section to render.
  await expect(page.getByTestId('danger-zone-section')).toBeVisible({
    timeout: 10_000,
  });

  // Confirm the export card and button are visible (Derrick has tenant:export).
  const exportCard = page.getByTestId('danger-zone-export-card');
  await expect(exportCard).toBeVisible({ timeout: 5_000 });

  const exportBtn = page.getByTestId('danger-zone-export-button');
  await expect(exportBtn).toBeVisible();
  await expect(exportBtn).toBeEnabled();

  // Wait for the download event, then click the button.
  // exportTenantJson uses _triggerBlobDownload → programmatic <a download>
  // click which Playwright intercepts as a download event.
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
  await exportBtn.click();
  const download = await downloadPromise;

  // Filename must match: <tenant-slug>-export-<timestamp>.json
  // e.g. "acme-export-2026-04-20T12-34-56.json"
  const filename = download.suggestedFilename();
  expect(filename).toMatch(/^acme-export-.+\.json$/);

  // Success toast should also appear.
  await expect(
    page.getByRole('alert').filter({ hasText: /export started/i }),
  ).toBeVisible({ timeout: 5_000 });
});
