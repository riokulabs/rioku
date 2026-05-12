import { test, expect } from '@playwright/test';

// "External" means anything off-host. The SPA is served by the daemon
// (`:7778` in CI/sandbox); the legacy stage-1 dev-server lived on `:5173`.
// Whitelist both, plus any host the test is currently hitting (driven by
// playwright config's `baseURL`) so future host changes don't silently
// flag every same-origin request as telemetry.
test('admin never phones home — no external requests on page load', async ({ page, baseURL }) => {
  const allowedHosts = new Set<string>();
  if (baseURL) {
    try {
      allowedHosts.add(new URL(baseURL).host);
    } catch {
      // ignore malformed baseURL — fall back to the static allowlist below.
    }
  }
  allowedHosts.add('localhost:7778');
  allowedHosts.add('localhost:5173');

  const external: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    try {
      const u = new URL(url);
      if (allowedHosts.has(u.host)) return;
    } catch {
      // Non-URL scheme (chrome-extension://, devtools://, etc.) — ignore.
      return;
    }
    external.push(url);
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(
    external,
    `Telemetry commitment violated. External requests: ${external.join('\n')}`,
  ).toEqual([]);
});
