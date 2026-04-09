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

  // Login via API and capture cookies (including HttpOnly session cookie).
  // Playwright's storageState doesn't include HttpOnly cookies from browser login,
  // so we use the API directly and build the storage state manually.
  async function loginAndSave(username: string, password: string, path: string) {
    const res = await fetch('http://localhost:7778/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`Login failed for ${username}: ${res.status}`);

    // Extract Set-Cookie header to get the session cookie.
    const setCookies = res.headers.getSetCookie();
    const cookies: Array<{
      name: string; value: string; domain: string; path: string;
      httpOnly: boolean; secure: boolean; sameSite: 'Lax' | 'Strict' | 'None';
    }> = [];

    for (const sc of setCookies) {
      const parts = sc.split(';').map(p => p.trim());
      const [nameVal, ...attrs] = parts;
      const [name, value] = nameVal.split('=', 2);
      cookies.push({
        name,
        value,
        domain: 'localhost',
        path: '/',
        httpOnly: attrs.some(a => a.toLowerCase() === 'httponly'),
        secure: attrs.some(a => a.toLowerCase() === 'secure'),
        sameSite: 'Lax',
      });
    }

    const fs = await import('fs');
    fs.mkdirSync('e2e/.auth', { recursive: true });
    fs.writeFileSync(path, JSON.stringify({
      cookies,
      origins: [],
    }));
  }

  await loginAndSave('testadmin', 'TestAdmin123!', 'e2e/.auth/admin.json');
  await loginAndSave('testviewer', 'TestView123!', 'e2e/.auth/viewer.json');
  await loginAndSave('testoperator', 'TestOperator123!', 'e2e/.auth/operator.json');

  await browser.close();
}

export default globalSetup;
