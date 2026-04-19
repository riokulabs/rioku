/**
 * E2E smoke tests for the Sites page — Task 2d.28.
 *
 * Coverage:
 *   - Seeded sites are visible in the list.
 *   - The create wizard walks all 5 steps for a minimal valid `new_upstream`
 *     flow and the resulting site appears in the list.
 *   - The typed-domain delete modal removes a site.
 *   - The "Advanced configuration" deep-link from a site with a linked
 *     service lands on the service detail route.
 *
 * Every selector anchors on stable roles / names / data-testids. The
 * authedPage fixture seeds Derrick + all tenants so /t/acme/sites is
 * reachable without walking the login flow.
 */
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';

// Unique per test run so parallel workers don't collide.
function uniqueDomain(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return `e2e-${String(Date.now())}-${String(n)}.example.com`;
}

test('seeded sites render on /t/acme/sites', async ({ authedPage: page }) => {
  await page.goto('/t/acme/sites');

  // Page heading.
  await expect(page.getByRole('heading', { name: /^sites$/i })).toBeVisible();

  // The "New site" CTA proves the route mounted with write permissions.
  await expect(page.getByRole('button', { name: /new site/i })).toBeVisible();

  // Wait for the list to hydrate — DataTable renders rows with role="row"
  // inside the tbody. At least one seeded row must show up for acme.
  const rows = page.locator('tbody tr[role="row"]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
});

test('wizard creates a site and the row appears in the list', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/sites');

  const domain = uniqueDomain();
  const siteName = `e2e-${String(Date.now())}`;

  // Open wizard.
  await page.getByRole('button', { name: /new site/i }).click();
  const dialog = page.getByRole('dialog', { name: /create site/i });
  await expect(dialog).toBeVisible();

  // The sidebar's DataTable pagination controls also render buttons with
  // aria-label="next" — scope every wizard interaction to the dialog so
  // strict-mode locators don't collide.
  const nextBtn = dialog.getByRole('button', { name: 'Next', exact: true });

  // Step 1 — Hostname.
  await dialog.getByRole('textbox', { name: /site name/i }).fill(siteName);
  await dialog.getByRole('textbox', { name: /^domain$/i }).fill(domain);
  await nextBtn.click();

  // Step 2 — Upstream. Switch to "Point at new upstream" to keep the flow
  // independent of whatever services happen to be seeded in acme. Mantine's
  // SegmentedControl renders as a row of labels — just click by text.
  await dialog.getByText(/point at new upstream/i).click();
  await dialog.getByRole('textbox', { name: /^host$/i }).fill('backend.internal');
  await nextBtn.click();

  // Step 3 — TLS. Keep the default "auto" — it has no extra required fields
  // so the step is already valid.
  await nextBtn.click();

  // Step 4 — Policies. Keep defaults (no basic auth, no rate limit, no
  // redirects).
  await nextBtn.click();

  // Step 5 — Review + Create.
  await dialog.getByTestId('wizard-create-site').click();

  // After create the drawer flips to detail view. The site should now be
  // visible in the list (close drawer by clicking backdrop would be racy;
  // instead assert the row is in the DOM — the list component subscribes to
  // the mock store and refreshes automatically).
  await expect(
    page.getByText(domain, { exact: false }).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test('delete modal removes a newly-created site', async ({
  authedPage: page,
}) => {
  // Seed a site directly via the mock store so we don't coupling the delete
  // test to the wizard behaviour (covered above).
  const domain = uniqueDomain();
  await page.goto('/t/acme/sites');
  // goto() triggers addInitScript (localStorage.clear) which forces the
  // store to re-seed. Wait for the seed to finish before probing tenants.
  await page.waitForFunction(() => {
    const store = (
      window as unknown as {
        __RIOKU_STORE?: {
          getState: () => { tenants: Record<string, unknown> };
        };
      }
    ).__RIOKU_STORE;
    if (!store) return false;
    return Object.keys(store.getState().tenants).length > 0;
  }, null, { timeout: 10_000 });

  await page.evaluate((dom) => {
    const store = (
      window as unknown as {
        __RIOKU_STORE?: {
          getState: () => {
            addEntity: (kind: string, entity: Record<string, unknown>) => void;
            tenants: Record<string, { id: string; slug: string }>;
          };
        };
      }
    ).__RIOKU_STORE;
    if (!store) throw new Error('__RIOKU_STORE not found');
    const state = store.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acme) throw new Error('acme tenant not seeded');
    const id = `e2e-site-${String(Date.now())}`;
    state.addEntity('sites', {
      id,
      tenant_id: acme.id,
      name: dom,
      domain: dom,
      enabled: true,
      tls_mode: 'off',
      basic_auth_enabled: false,
      rate_limit_preset: 'none',
      redirect_rules: [],
      upstream_protocol: 'http',
      upstream_host: 'backend.internal',
      upstream_port: 8080,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }, domain);

  // Confirm the row is rendered.
  const rowSelector = page.locator(`tbody tr[role="row"]:has-text("${domain}")`);
  await expect(rowSelector).toBeVisible({ timeout: 5_000 });

  // Open the row actions menu → Delete…
  await rowSelector.getByRole('button', { name: /actions for/i }).click();
  await page.getByRole('menuitem', { name: /delete/i }).click();

  // Typed-domain modal.
  const modal = page.getByRole('dialog', { name: /delete site/i });
  await expect(modal).toBeVisible();
  await modal.getByRole('textbox', { name: /confirm site domain/i }).fill(domain);
  await modal.getByRole('button', { name: /delete permanently/i }).click();

  // Row should disappear.
  await expect(rowSelector).toHaveCount(0, { timeout: 5_000 });
});

test('Advanced configuration deep-link navigates to the linked service', async ({
  authedPage: page,
}) => {
  await page.goto('/t/acme/sites');
  // Wait for the mock-store re-seed to finish after the page load so the
  // tenants/sites collections are populated before we probe them.
  await page.waitForFunction(() => {
    const store = (
      window as unknown as {
        __RIOKU_STORE?: {
          getState: () => {
            tenants: Record<string, unknown>;
            sites: Record<string, unknown>;
          };
        };
      }
    ).__RIOKU_STORE;
    if (!store) return false;
    const state = store.getState();
    return (
      Object.keys(state.tenants).length > 0 &&
      Object.keys(state.sites).length > 0
    );
  }, null, { timeout: 10_000 });

  // Pick the first seeded site that has a linked service. The list exposes
  // the underlying store state to the probe so we can pick a row that has a
  // Service badge (non-null `upstream_service_id`).
  const pick = await page.evaluate(() => {
    const store = (
      window as unknown as {
        __RIOKU_STORE?: {
          getState: () => {
            tenants: Record<string, { id: string; slug: string }>;
            sites: Record<
              string,
              {
                id: string;
                tenant_id: string;
                domain: string;
                upstream_service_id?: string | null;
              }
            >;
          };
        };
      }
    ).__RIOKU_STORE;
    if (!store) throw new Error('__RIOKU_STORE not found');
    const state = store.getState();
    const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
    if (!acme) throw new Error('acme tenant not seeded');
    const site = Object.values(state.sites).find(
      (s) =>
        s.tenant_id === acme.id &&
        typeof s.upstream_service_id === 'string' &&
        s.upstream_service_id.length > 0,
    );
    if (!site) throw new Error('no acme site with a linked service');
    const serviceId = site.upstream_service_id;
    if (typeof serviceId !== 'string') {
      throw new Error('site has no linked service id');
    }
    return {
      domain: site.domain,
      serviceId,
    };
  });

  // Open the site detail drawer.
  await page.locator(`tbody tr[role="row"]:has-text("${pick.domain}")`).click();

  // Click "Advanced configuration" — route-level navigation, so we await the
  // URL to change instead of the drawer content.
  const advancedLink = page.getByRole('link', { name: /advanced configuration/i });
  await expect(advancedLink).toBeVisible();
  await advancedLink.click();

  // The file-based route generates either /services_/<id> or /services/<id>
  // depending on whether the _flat_ route wins over the folder route in the
  // local tree. Accept both.
  await expect(page).toHaveURL(
    new RegExp(`/t/acme/services_?/${pick.serviceId}`),
    { timeout: 5_000 },
  );
});
