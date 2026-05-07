/**
 * Plan 12 — Subdomain URL mode cross-context session sharing.
 *
 * Verifies that when a tenant uses URL mode = "subdomain" with
 * `parent_domain` set, the session cookie is issued with
 * `Domain=.<parent_domain>` so it is automatically shared across all
 * subdomains served by the same daemon.
 *
 * This test is currently SKIPPED. It requires a running sandbox/daemon
 * with:
 *   - real DNS (or `/etc/hosts`) entries for `acme.localhost` and
 *     `globex.localhost` resolving to the daemon
 *   - two seeded tenants (`acme` and `globex`) configured in
 *     subdomain URL mode with `parent_domain="localhost"`
 *   - HTTPS with a wildcard cert covering `*.localhost` (see
 *     `make sandbox-certs`)
 *
 * Stage-1 mock store cannot exercise real cookies / cross-context
 * propagation because there is no HTTP server emitting Set-Cookie. Once
 * `VITE_USE_MOCKS=false` lands (stage-2 entry point), unskip and adapt
 * the URLs to whatever sandbox layout is used at that time.
 *
 * Tracking: Plan 12, contrib-docs/development/subdomain-mode.md.
 */
import { chromium, expect, test } from '@playwright/test';

const PARENT_DOMAIN = 'localhost';
const TENANT_A = 'acme';
const TENANT_B = 'globex';
const HOST_A = `${TENANT_A}.${PARENT_DOMAIN}`;
const HOST_B = `${TENANT_B}.${PARENT_DOMAIN}`;
// process.env access is intentionally duck-typed — Playwright provides
// it at runtime; @types/node is not in the web tsconfig.
declare const process: { env: Record<string, string | undefined> };
const PORT = process.env.RIOKU_E2E_PORT ?? '7778';
const SCHEME = process.env.RIOKU_E2E_SCHEME ?? 'https';
const URL_A = `${SCHEME}://${HOST_A}:${PORT}`;
const URL_B = `${SCHEME}://${HOST_B}:${PORT}`;

// Skipped until VITE_USE_MOCKS=false lands and the sandbox provisions
// wildcard TLS + multi-tenant DNS. See subdomain-mode.md.
test.describe.skip('Plan 12 — cross-subdomain session sharing', () => {
  test('cookie set on tenant A is reused on tenant B without re-login', async () => {
    const browser = await chromium.launch();

    // Two contexts simulate two physically independent browser profiles
    // that share only the cookie jar of the parent domain.
    const ctxA = await browser.newContext({ ignoreHTTPSErrors: true });
    const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });

    try {
      const pageA = await ctxA.newPage();
      await pageA.goto(`${URL_A}/login`);
      await pageA.getByLabel('Email').fill('root@example.com');
      await pageA.getByLabel('Password').fill('TestRoot1234!');
      await pageA.getByRole('button', { name: /sign in/i }).click();
      await expect(pageA).toHaveURL(/\/$|\/dashboard/);

      const cookies = await ctxA.cookies();
      const session = cookies.find((c) => c.name === 'rioku_session');
      expect(session, 'rioku_session cookie must exist').toBeDefined();
      // Cookie domain MUST be parent-scoped so it is shared across
      // subdomains. Browsers normalize a leading-dot prefix.
      expect(session?.domain).toMatch(new RegExp(`^\\.?${PARENT_DOMAIN}$`));

      // Replay the cookie into context B and load tenant B — should
      // already be authenticated.
      await ctxB.addCookies(cookies.filter((c) => c.name === 'rioku_session'));
      const pageB = await ctxB.newPage();
      await pageB.goto(`${URL_B}/`);
      // Auth landing should NOT redirect to /login; pick a tenant-scoped
      // landing element to assert on.
      await expect(pageB).not.toHaveURL(/\/login/);
    } finally {
      await ctxA.close();
      await ctxB.close();
      await browser.close();
    }
  });
});
