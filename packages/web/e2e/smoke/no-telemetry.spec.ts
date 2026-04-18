import { test, expect } from '@playwright/test';

test('admin never phones home — no external requests on page load', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('http://localhost:5173') && !url.startsWith('ws://localhost:5173') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      external.push(url);
    }
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(external, `Telemetry commitment violated. External requests: ${external.join('\n')}`).toEqual([]);
});
