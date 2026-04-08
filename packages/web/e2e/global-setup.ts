import { chromium, type FullConfig } from '@playwright/test';

const HEALTH_URL = 'http://localhost:7778/api/v1/health';
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

async function waitForHealth(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Sandbox did not become healthy within ${MAX_WAIT_MS}ms`);
}

async function globalSetup(_config: FullConfig): Promise<void> {
  await waitForHealth();

  // Pre-authenticate testadmin and save storage state for reuse
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: 'http://localhost:7778' });
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByLabel('Username').fill('testadmin');
  await page.getByLabel('Password').fill('TestAdmin123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('/');

  await context.storageState({ path: 'e2e/.auth/admin.json' });
  await browser.close();

  // Pre-authenticate testviewer
  const browser2 = await chromium.launch();
  const ctx2 = await browser2.newContext({ baseURL: 'http://localhost:7778' });
  const page2 = await ctx2.newPage();

  await page2.goto('/login');
  await page2.getByLabel('Username').fill('testviewer');
  await page2.getByLabel('Password').fill('TestView123!');
  await page2.getByRole('button', { name: 'Log in' }).click();
  await page2.waitForURL('/');

  await ctx2.storageState({ path: 'e2e/.auth/viewer.json' });
  await browser2.close();

  // Pre-authenticate testoperator
  const browser3 = await chromium.launch();
  const ctx3 = await browser3.newContext({ baseURL: 'http://localhost:7778' });
  const page3 = await ctx3.newPage();

  await page3.goto('/login');
  await page3.getByLabel('Username').fill('testoperator');
  await page3.getByLabel('Password').fill('TestOp123!');
  await page3.getByRole('button', { name: 'Log in' }).click();
  await page3.waitForURL('/');

  await ctx3.storageState({ path: 'e2e/.auth/operator.json' });
  await browser3.close();
}

export default globalSetup;
