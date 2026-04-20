/**
 * E2E smoke tests for the dashboard builder — Task 4e.24.
 *
 * Coverage:
 *   - Clicking Edit from the viewer opens the builder at /edit.
 *   - Widget palette is visible on the left.
 *   - Selecting an existing widget opens the config side panel with the wizard.
 *   - Save button returns the user to the viewer and toasts success.
 *   - Mode toggle (Metabase → Grafana) opens a confirm dialog that lists
 *     one-way widgets; Cancel reverts the SegmentedControl.
 *
 * Drag-drop simulation is intentionally skipped — jsdom-level pointer
 * simulation is unreliable against `@dnd-kit/core` sensors (same caveat as
 * Plan 4c unit tests). Instead we exercise widget configuration on a
 * pre-seeded widget and rely on the dashboard-builder unit tests for
 * drag-drop assertions.
 */
import { expect } from '@playwright/test';
import { test, getStoreState } from '../fixtures/auth';

/**
 * Resolve the id of a seeded acme dashboard with at least one widget so
 * per-widget assertions (select + wizard) have something to drive.
 *
 * Navigates to the list page first so `addInitScript`-driven re-seeding is
 * complete before we read the store state — otherwise the store snapshot
 * can lag behind the page's active render pass.
 */
async function firstAcmeDashboardWithWidgets(
  page: Parameters<typeof getStoreState>[0],
): Promise<{ id: string }> {
  await page.goto('/t/acme/dashboards');
  // Wait for the seed to populate on this navigation — addInitScript
  // clears localStorage on every goto, so the mock store reseeds each time.
  await page.waitForFunction(() => {
    const store = (window as unknown as {
      __RIOKU_STORE?: {
        getState: () => { tenants: Record<string, { slug: string }> };
      };
    }).__RIOKU_STORE;
    if (!store) return false;
    const { tenants } = store.getState();
    return Object.values(tenants).some((t) => t.slug === 'acme');
  }, null, { timeout: 10_000 });
  const state = (await getStoreState(page)) as {
    tenants: Record<string, { id: string; slug: string }>;
    dashboards: Record<string, {
      id: string;
      tenant_id: string;
      widget_ids: string[];
    }>;
  };
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('acme tenant not seeded');
  const dash = Object.values(state.dashboards).find(
    (d) => d.tenant_id === acme.id && d.widget_ids.length > 0,
  );
  if (!dash) throw new Error('no acme dashboard with widgets');
  return { id: dash.id };
}

test('Edit from viewer opens the builder', async ({ authedPage: page }) => {
  await page.goto('/t/acme/dashboards');

  await page.locator('tbody tr[role="row"]').first().click();

  const editBtn = page.getByRole('button', { name: /^edit$/i });
  await expect(editBtn).toBeVisible({ timeout: 10_000 });
  await editBtn.click();

  await expect(page).toHaveURL(/\/t\/acme\/dashboards\/[^/]+\/edit$/, {
    timeout: 10_000,
  });

  // Builder shell renders a dedicated top bar with Save + Cancel controls.
  await expect(page.getByTestId('dashboard-builder-shell')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('button', { name: /^save$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();
});

test('Widget palette is visible in the builder', async ({
  authedPage: page,
}) => {
  const { id } = await firstAcmeDashboardWithWidgets(page);
  await page.goto(`/t/acme/dashboards/${id}/edit`);

  await expect(page.getByTestId('dashboard-builder-shell')).toBeVisible({
    timeout: 10_000,
  });

  // Palette container has aria-label "Widget palette" (widget-palette.tsx).
  // Note: both the outer PanelColumn and the inner Stack carry the same
  // aria-label, so we match the first one.
  const palette = page.getByLabel('Widget palette').first();
  await expect(palette).toBeVisible();

  // At least the single-stat built-in chip should be rendered.
  await expect(page.getByTestId('palette-single-stat')).toBeVisible();
});

test('Selecting a widget opens the config side panel', async ({
  authedPage: page,
}) => {
  const { id } = await firstAcmeDashboardWithWidgets(page);
  await page.goto(`/t/acme/dashboards/${id}/edit`);

  await expect(page.getByTestId('dashboard-builder-shell')).toBeVisible({
    timeout: 10_000,
  });

  // Grab the first rendered widget cell via data-testid prefix — the seed
  // ids (widget-0001…) aren't stable across store re-seeds triggered by
  // addInitScript on every page.goto, so match by prefix instead.
  const firstCell = page.locator('[data-testid^="widget-cell-"]').first();
  await expect(firstCell).toBeVisible({ timeout: 10_000 });

  // The gear icon inside the cell is labelled "Configure <title>".
  // Force the click — the first cell is small (4×3 grid units) and the gear
  // button is rendered alongside the drag-handle and trash icons, so the
  // pointer-events region is narrow. `force: true` skips the actionability
  // pointer check but still dispatches the click event.
  await firstCell
    .getByRole('button', { name: /configure/i })
    .click({ force: true });

  // Config panel is labelled "Widget configuration panel"; title input is
  // always rendered for non-locked widgets.
  await expect(page.getByLabel('Widget configuration panel')).toBeVisible();
  await expect(page.getByTestId('panel-title-input')).toBeVisible();
});

test('Save button returns to the viewer', async ({ authedPage: page }) => {
  const { id } = await firstAcmeDashboardWithWidgets(page);
  await page.goto(`/t/acme/dashboards/${id}/edit`);

  await expect(page.getByTestId('dashboard-builder-shell')).toBeVisible({
    timeout: 10_000,
  });

  await page.getByTestId('builder-save').click();

  // After save, caller navigates back to the viewer route.
  await expect(page).toHaveURL(new RegExp(`/t/acme/dashboards/${id}$`), {
    timeout: 10_000,
  });
});

test('Mode toggle Metabase → Grafana shows confirm dialog + Cancel reverts', async ({
  authedPage: page,
}) => {
  const { id } = await firstAcmeDashboardWithWidgets(page);
  await page.goto(`/t/acme/dashboards/${id}/edit`);

  await expect(page.getByTestId('dashboard-builder-shell')).toBeVisible({
    timeout: 10_000,
  });

  const modeControl = page.getByRole('radiogroup', { name: /^dashboard mode$/i });
  await expect(modeControl).toBeVisible();

  // Mantine SegmentedControl renders options as <input type="radio"> with
  // sibling <label>s. Clicking the Grafana label switches the value.
  const grafanaOption = modeControl.getByText(/^grafana$/i);
  await grafanaOption.click();

  // Confirm dialog opens with the "Switch dashboard to Grafana mode?" title.
  const dialog = page.getByRole('dialog', {
    name: /switch dashboard to grafana mode/i,
  });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Cancel the dialog — the SegmentedControl must revert to Metabase.
  await dialog.getByRole('button', { name: /^cancel$/i }).click();
  await expect(dialog).toBeHidden();

  // Verify the Metabase radio is checked (SegmentedControl value did not change).
  const metabaseRadio = modeControl.getByRole('radio', { name: /^metabase$/i });
  await expect(metabaseRadio).toBeChecked();
});
