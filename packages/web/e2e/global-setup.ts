import { type FullConfig } from '@playwright/test';

const HEALTH_URL = 'http://localhost:7778/api/v1/health';
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

async function globalSetup(_config: FullConfig): Promise<void> {
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

export default globalSetup;
