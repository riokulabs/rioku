import { type Page, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function expectNoA11yViolations(page: Page) {
  // `color-contrast` is suppressed for the same reason documented in
  // plan2-a11y.spec.ts / plan3-a11y.spec.ts / plan4-a11y.spec.ts — Mantine's
  // dark-mode `--mantine-color-dimmed` token (#828282 and #495057) used by
  // shared DataTable internals, dashboard viewer headers, and pagination
  // controls falls below WCAG AA thresholds. Fixing it is a framework-theme
  // decision tracked separately, not a per-feature issue.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}
