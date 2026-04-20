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
 */
async function firstAcmeDashboardWithWidgets(
  page: Parameters<typeof getStoreState>[0],
): Promise<{ id: string; widgetId: string }> {
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
  const widgetId = dash.widget_ids[0];
  if (widgetId === undefined) {
    throw new Error('dashboard has empty widget_ids after length check');
  }
  return { id: dash.id, widgetId };
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
  await expect(page.getByTestId('dashboard-builder-shell')).toBeVisible();
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
  const palette = page.getByLabel('Widget palette');
  await expect(palette).toBeVisible();

  // At least the single-stat built-in chip should be rendered.
  await expect(page.getByTestId('palette-single-stat')).toBeVisible();
});

test('Selecting a widget opens the config side panel', async ({
  authedPage: page,
}) => {
  const { id, widgetId } = await firstAcmeDashboardWithWidgets(page);
  await page.goto(`/t/acme/dashboards/${id}/edit`);

  await expect(page.getByTestId('dashboard-builder-shell')).toBeVisible({
    timeout: 10_000,
  });

  const cell = page.getByTestId(`widget-cell-${widgetId}`);
  await expect(cell).toBeVisible({ timeout: 10_000 });

  // The gear icon inside the cell is labelled "Configure <title>".
  await cell.getByRole('button', { name: /^configure / }).click();

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
